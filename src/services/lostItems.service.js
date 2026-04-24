'use strict';

const prisma = require('../config/database');
const { generateDocNumber } = require('./docNumbering.service');
const { checkPeriodLock } = require('./periodGuard.service');
const { normalizeRole } = require('./rbac.service');
const { APPROVAL_CHAIN, STATUS_BY_APPROVED_STEP, createMovementApprovalRequest } = require('./breakage.service');
const { incrementTotalQtyLost } = require('./stockCumulative.service');

const TENANT_WIDE_MOVEMENT_APPROVAL_ROLES = new Set([
    'COST_CONTROL',
    'FINANCE_MANAGER',
    'GENERAL_MANAGER',
    'ADMIN',
    'ORG_MANAGER',
    'SUPER_ADMIN',
]);

/** In-flight workflow only (excludes final APPROVED — archive tab uses status=APPROVED). */
const PIPELINE_NON_FINAL_STATUSES = ['DEPT_APPROVED', 'COST_CONTROL_APPROVED', 'FINANCE_APPROVED'];

/**
 * Same as breakage: keep processed-but-not-final documents in the role’s workflow tab.
 */
const buildRolePipelineStageStatusWhere = (statusRaw, userRole) => {
    const raw = typeof statusRaw === 'string' ? statusRaw.trim() : '';
    if (!raw || raw.includes(',')) return null;
    const role = userRole ? normalizeRole(userRole) : '';
    if (role === 'COST_CONTROL' && raw === 'DEPT_APPROVED') {
        return { status: { in: ['DEPT_APPROVED', 'COST_CONTROL_APPROVED'] } };
    }
    if (role === 'FINANCE_MANAGER' && raw === 'COST_CONTROL_APPROVED') {
        return { status: { in: ['COST_CONTROL_APPROVED', 'FINANCE_APPROVED'] } };
    }
    if (role === 'GENERAL_MANAGER' && raw === 'FINANCE_APPROVED') {
        return { status: 'FINANCE_APPROVED' };
    }
    return null;
};

const buildStatusWhere = (statusRaw) => {
    const raw = typeof statusRaw === 'string' ? statusRaw.trim() : '';
    if (!raw) return {};
    if (raw.includes(',')) {
        const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
        return parts.length === 0 ? {} : parts.length === 1 ? { status: parts[0] } : { status: { in: parts } };
    }
    return { status: raw };
};

const DEPT_MANAGER_IN_FLIGHT_STATUSES = ['DEPT_APPROVED', 'COST_CONTROL_APPROVED', 'FINANCE_APPROVED'];

const buildDeptManagerListScopeWhere = (user, statusWhere) => {
    const role = user?.role ? normalizeRole(user.role) : '';
    if (role !== 'DEPT_MANAGER' || !user?.id) return {};
    const s = statusWhere?.status;
    if (!s) return {};
    if (s === 'APPROVED') {
        return { createdBy: user.id };
    }
    if (s.in && Array.isArray(s.in)) {
        const got = [...s.in].map(String).sort().join('|');
        const want = [...DEPT_MANAGER_IN_FLIGHT_STATUSES].sort().join('|');
        if (got === want) {
            return { createdBy: user.id };
        }
    }
    return {};
};

const lostListInclude = (user) => {
    const role = user?.role ? normalizeRole(user.role) : '';
    const fullApproval = TENANT_WIDE_MOVEMENT_APPROVAL_ROLES.has(role);
    const base = {
        createdByUser: { select: { id: true, firstName: true, lastName: true } },
        getPass: { select: { id: true, passNo: true } },
        lines: {
            select: {
                qtyInBaseUnit: true,
                item: { select: { id: true, name: true, barcode: true } },
            },
        },
        _count: { select: { lines: true } },
    };
    if (fullApproval) {
        return {
            ...base,
            approvalRequests: {
                include: {
                    steps: {
                        orderBy: { stepNumber: 'asc' },
                        include: {
                            actedByUser: { select: { id: true, firstName: true, lastName: true } },
                            requiredRole: { select: { id: true, code: true } },
                        },
                    },
                },
            },
        };
    }
    return {
        ...base,
        approvalRequests: {
            select: { id: true, status: true, currentStep: true, totalSteps: true, createdAt: true },
        },
    };
};

const LOST_INCLUDE = {
    createdByUser: { select: { id: true, firstName: true, lastName: true } },
    getPass: { select: { id: true, passNo: true } },
    lines: {
        include: {
            item: { select: { id: true, name: true, barcode: true } },
            location: { select: { id: true, name: true } },
        },
    },
    approvalRequests: {
        include: {
            steps: {
                orderBy: { stepNumber: 'asc' },
                include: {
                    actedByUser: { select: { id: true, firstName: true, lastName: true } },
                    requiredRole: { select: { id: true, code: true } },
                },
            },
        },
    },
};

const getApproval = (doc) => doc.approvalRequests || null;

const LOST_FLOW = [
    { status: 'DRAFT', nextStatus: 'DEPT_APPROVED', role: 'DEPT_MANAGER' },
    { status: 'DEPT_APPROVED', nextStatus: 'COST_CONTROL_APPROVED', role: 'COST_CONTROL' },
    { status: 'COST_CONTROL_APPROVED', nextStatus: 'FINANCE_APPROVED', role: 'FINANCE_MANAGER' },
    { status: 'FINANCE_APPROVED', nextStatus: 'APPROVED', role: 'GENERAL_MANAGER' },
];

const err = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

const GET_PASS_ACCOUNTABILITY = new Set([
    'EMPLOYEE_DEDUCTION',
    'COMPANY_LOSS',
    'TARGET_HOTEL_COMPENSATION',
]);
const SUGGESTED_ACTIONS = new Set(['EMPLOYEE', 'HOTEL']);

const AUTO_APPROVAL_NOTE = 'Auto-approved on creation';

const ensureCanApprove = (doc, userRole) => {
    const current = LOST_FLOW.find((s) => s.status === doc.status);
    if (!current) throw err(`Document status ${doc.status} is not approvable.`);
    if (userRole !== current.role && userRole !== 'ADMIN' && userRole !== 'ORG_MANAGER') {
        throw err(`Status ${doc.status} requires role ${current.role}.`, 403);
    }
    return current;
};

const listLostItems = async (tenantId, query = {}, user = null) => {
    const skipN = Number.parseInt(String(query.skip ?? 0), 10) || 0;
    const takeN = Math.min(Number.parseInt(String(query.take ?? 20), 10) || 20, 100);
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const status = typeof query.status === 'string' ? query.status.trim() : '';
    const sourceType = typeof query.sourceType === 'string' ? query.sourceType.trim() : '';
    const pipeline = query.pipeline;

    const role = user?.role ? normalizeRole(user.role) : '';
    const tenantWide = TENANT_WIDE_MOVEMENT_APPROVAL_ROLES.has(role);

    let statusWhere = {};
    if (status) {
        const expanded = buildRolePipelineStageStatusWhere(status, role);
        statusWhere = expanded ?? buildStatusWhere(status);
    } else if (tenantWide && (pipeline === '1' || pipeline === 'true' || pipeline === true)) {
        statusWhere = { status: { in: PIPELINE_NON_FINAL_STATUSES } };
    }

    const deptManagerScope = buildDeptManagerListScopeWhere(user, statusWhere);

    const sourceFilter =
        sourceType === 'INTERNAL'
            ? { getPassId: null }
            : sourceType === 'GET_PASS_RETURN'
              ? { getPassId: { not: null } }
              : {};

    const where = {
        tenantId,
        movementType: 'LOST',
        ...sourceFilter,
        ...statusWhere,
        ...deptManagerScope,
        ...(search
            ? {
                  OR: [
                      { documentNo: { contains: search, mode: 'insensitive' } },
                      { reason: { contains: search, mode: 'insensitive' } },
                      { lines: { some: { item: { name: { contains: search, mode: 'insensitive' } } } } },
                      { lines: { some: { item: { barcode: { contains: search, mode: 'insensitive' } } } } },
                  ],
              }
            : {}),
    };

    const listInclude = lostListInclude(user);

    const [documents, total] = await Promise.all([
        prisma.movementDocument.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: skipN,
            take: takeN,
            include: listInclude,
        }),
        prisma.movementDocument.count({ where }),
    ]);

    const items = documents.map((doc) => {
        const totalQtyLost = doc.lines.reduce((sum, line) => sum + Number(line.qtyInBaseUnit || 0), 0);
        const firstLine = doc.lines[0];
        const ar = doc.approvalRequests;
        let approvalRequests = [];
        if (ar) {
            if (ar.steps) {
                approvalRequests = [
                    {
                        id: ar.id,
                        status: ar.status,
                        currentStep: ar.currentStep,
                        totalSteps: ar.totalSteps,
                        createdAt: ar.createdAt,
                        steps: ar.steps,
                    },
                ];
            } else {
                approvalRequests = [
                    {
                        id: ar.id,
                        status: ar.status,
                        currentStep: ar.currentStep,
                        totalSteps: ar.totalSteps,
                        createdAt: ar.createdAt,
                    },
                ];
            }
        }
        return {
            id: doc.id,
            documentNo: doc.documentNo,
            status: doc.status,
            sourceType: doc.sourceType,
            getPassId: doc.getPassId,
            getPass: doc.getPass,
            reason: doc.reason,
            notes: doc.notes,
            createdAt: doc.createdAt,
            createdByUser: doc.createdByUser,
            itemName: firstLine?.item?.name || '',
            itemBarcode: firstLine?.item?.barcode || null,
            qtyLost: totalQtyLost,
            totalQtyLost,
            approvalRequests,
            _count: doc._count,
        };
    });

    return { items, total };
};

const createLost = async (tenantId, userId, _userRole, body = {}) => {
    const {
        lines = [],
        reason,
        notes,
        sourceLocationId,
        documentDate,
        accountabilityType,
        accountability,
        suggestedAction,
        responsibleEmployeeName,
    } = body;
    if (!reason?.trim()) throw err('Reason is required.');
    if (!sourceLocationId) throw err('Location is required.');
    if (!Array.isArray(lines) || lines.length === 0) throw err('At least one line is required.');
    if (!suggestedAction || !SUGGESTED_ACTIONS.has(String(suggestedAction).trim().toUpperCase())) {
        throw err('Suggested action is required and must be EMPLOYEE or HOTEL.');
    }
    const normalizedSuggestedAction = String(suggestedAction).trim().toUpperCase();

    const location = await prisma.location.findFirst({ where: { id: sourceLocationId, tenantId } });
    if (!location) throw err('Location not found.', 404);

    const documentNo = await generateDocNumber(tenantId, 'LST', new Date());

    const firstStepAccountabilityType =
        typeof accountabilityType === 'string' && accountabilityType.trim()
            ? accountabilityType.trim()
            : typeof accountability === 'string' && accountability.trim()
                ? accountability.trim()
                : undefined;

    return prisma.$transaction(async (tx) => {
        const doc = await tx.movementDocument.create({
            data: {
                tenantId,
                documentNo,
                movementType: 'LOST',
                sourceType: 'INTERNAL',
                status: 'DEPT_APPROVED',
                sourceLocationId,
                reason: reason.trim(),
                notes: notes?.trim() || null,
                suggestedAction: normalizedSuggestedAction,
                responsibleEmployeeName:
                    typeof responsibleEmployeeName === 'string' && responsibleEmployeeName.trim()
                        ? responsibleEmployeeName.trim()
                        : null,
                documentDate: documentDate ? new Date(documentDate) : new Date(),
                createdBy: userId,
                lines: {
                    create: lines.map((line) => ({
                        itemId: line.itemId,
                        locationId: line.locationId || sourceLocationId,
                        qtyRequested: Number(line.qty),
                        qtyInBaseUnit: Number(line.qty),
                        unitCost: Number(line.unitCost || 0),
                        totalValue: Number(line.totalValue || 0),
                        notes: line.notes?.trim() || null,
                    })),
                },
            },
        });

        await createMovementApprovalRequest(tx, {
            tenantId,
            documentId: doc.id,
            createdBy: userId,
            requestType: 'LOST',
            deptApproverUserId: userId,
            firstStepComment: AUTO_APPROVAL_NOTE,
            firstStepAccountabilityType,
        });

        return tx.movementDocument.findFirst({ where: { id: doc.id }, include: LOST_INCLUDE });
    });
};

const getLostById = async (id, tenantId) => {
    const doc = await prisma.movementDocument.findFirst({
        where: { id, tenantId, movementType: 'LOST' },
        include: LOST_INCLUDE,
    });
    if (!doc) throw err('Lost document not found.', 404);
    return doc;
};

const applyStockImpactOnFinalApproval = async (tx, doc, userId) => {
    const isGetPassReturn = doc.sourceType === 'GET_PASS_RETURN';

    if (isGetPassReturn) {
        const existing = await tx.inventoryLedger.findFirst({
            where: { tenantId: doc.tenantId, referenceId: doc.id },
        });
        if (existing) throw err('Document has already been posted to ledger. Double-posting prevented.');

        for (const line of doc.lines) {
            const qty = Number(line.qtyInBaseUnit || 0);
            if (qty <= 0) continue;
            const unitCost = Number(line.unitCost || 0);

            await tx.inventoryLedger.create({
                data: {
                    tenantId: doc.tenantId,
                    itemId: line.itemId,
                    locationId: line.locationId,
                    movementType: 'LOST',
                    qtyIn: 0,
                    qtyOut: qty,
                    unitCost,
                    totalValue: qty * unitCost,
                    referenceType: 'LOST',
                    referenceId: doc.id,
                    referenceNo: doc.documentNo,
                    notes: doc.reason || null,
                    createdBy: userId,
                },
            });
            await incrementTotalQtyLost(tx, doc.tenantId, line.itemId, line.locationId, qty);
        }
        return;
    }

    for (const line of doc.lines) {
        const qty = Number(line.qtyInBaseUnit || 0);
        if (qty <= 0) continue;

        const stockKey = {
            tenantId_itemId_locationId: {
                tenantId: doc.tenantId,
                itemId: line.itemId,
                locationId: line.locationId,
            },
        };
        const stock = await tx.stockBalance.findUnique({ where: stockKey });
        const qtyBefore = Number(stock?.qtyOnHand || 0);
        if (qtyBefore < qty) {
            throw err(`Insufficient stock for ${line.item?.name || line.itemId}.`, 400);
        }
        const wac = Number(stock?.wacUnitCost || 0);

        await tx.inventoryLedger.create({
            data: {
                tenantId: doc.tenantId,
                itemId: line.itemId,
                locationId: line.locationId,
                movementType: 'LOST',
                qtyIn: 0,
                qtyOut: qty,
                unitCost: wac,
                totalValue: qty * wac,
                referenceType: 'LOST',
                referenceId: doc.id,
                referenceNo: doc.documentNo,
                notes: doc.reason || null,
                createdBy: userId,
            },
        });

        await tx.stockBalance.update({
            where: stockKey,
            data: {
                qtyOnHand: { decrement: qty },
                totalQtyLost: { increment: qty },
            },
        });
    }
};

/**
 * Lost docs created from get-pass returns (and any doc with an ApprovalRequest) use
 * {@link processLostApprovalStep} via POST /lost/:id/approve. Legacy approve-dept/cost/… routes only apply to
 * purely INTERNAL documents without an approval request.
 */
const shouldUseUnifiedLostApproval = (doc) =>
    doc.sourceType === 'GET_PASS_RETURN' || doc.approvalRequests != null;

const approveLostAtLevel = async (id, tenantId, userId, userRole, expectedStatus, body = {}) => {
    const doc = await getLostById(id, tenantId);

    if (shouldUseUnifiedLostApproval(doc)) {
        return processLostApprovalStep(
            id,
            tenantId,
            userId,
            userRole,
            'APPROVE',
            body.comment,
            body.accountability,
        );
    }

    if (doc.sourceType !== 'INTERNAL') throw err('Only internal lost documents can be approved manually.');
    if (doc.status !== expectedStatus) throw err(`Document must be in ${expectedStatus} status.`);
    const current = ensureCanApprove(doc, userRole);
    const isFinal = current.nextStatus === 'APPROVED';

    if (isFinal) {
        await checkPeriodLock(tenantId, doc.documentDate || doc.createdAt || new Date());
    }

    return prisma.$transaction(async (tx) => {
        if (isFinal) {
            await applyStockImpactOnFinalApproval(tx, doc, userId);
        }

        return tx.movementDocument.update({
            where: { id: doc.id },
            data: {
                status: current.nextStatus,
                ...(isFinal ? { postedAt: new Date() } : {}),
            },
            include: LOST_INCLUDE,
        });
    });
};

/**
 * Same 4-step approval chain as breakage (Cost → Finance → GM), for LOST documents that have an ApprovalRequest
 * (e.g. auto-created from get-pass return). Internal lost docs without an approval request keep using approve-dept/cost/… routes.
 */
const processLostApprovalStep = async (id, tenantId, userId, userRole, action, comment, accountability) => {
    const doc = await getLostById(id, tenantId);

    if (doc.status === 'APPROVED') throw err('Document is already APPROVED and locked. No further actions allowed.');
    if (doc.status === 'VOID') throw err('Document has been voided.');
    if (doc.status === 'REJECTED')
        throw err('Document is REJECTED. Resubmit from draft to continue workflow.');

    const approval = getApproval(doc);
    if (!approval) {
        throw err(
            'This lost document has no approval request. Use the department/cost/finance/GM endpoints for internal lost items.',
            404,
        );
    }

    const currentStepNo = approval.currentStep;
    const chain = APPROVAL_CHAIN.find((c) => c.step === currentStepNo);

    if (!chain) throw err('All approval steps already completed.');

    if (userRole !== chain.role && userRole !== 'ADMIN' && userRole !== 'ORG_MANAGER') {
        throw err(`Step ${currentStepNo} requires role ${chain.role}. Your role: ${userRole}`);
    }

    const step = approval.steps.find((s) => s.stepNumber === currentStepNo);
    if (!step) throw err(`Step ${currentStepNo} not found in approval chain.`, 404);
    if (step.status !== 'PENDING') throw err(`Step ${currentStepNo} has already been ${step.status}.`);

    const prevSteps = approval.steps.filter((s) => s.stepNumber < currentStepNo);
    for (const ps of prevSteps) {
        if (ps.status !== 'APPROVED') throw err(`Step ${ps.stepNumber} must be approved first.`);
    }

    const now = new Date();
    const isFinalApproveAction = action === 'APPROVE' && currentStepNo === approval.totalSteps;

    if (isFinalApproveAction) {
        await checkPeriodLock(tenantId, doc.documentDate || doc.createdAt || now);
    }

    return prisma.$transaction(async (tx) => {
        const stepUpdate = {
            status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
            actedBy: userId,
            actedAt: now,
            comment: comment?.trim() || null,
        };
        if (
            (doc.sourceType === 'GET_PASS_RETURN' || doc.sourceType === 'INTERNAL')
            && action === 'APPROVE'
            && typeof accountability === 'string'
            && GET_PASS_ACCOUNTABILITY.has(accountability)
        ) {
            stepUpdate.accountabilityType = accountability;
        }

        await tx.approvalStep.update({
            where: { id: step.id },
            data: stepUpdate,
        });

        if (action === 'REJECT') {
            await tx.approvalRequest.update({
                where: { id: approval.id },
                data: { status: 'REJECTED', resolvedAt: now },
            });
            await tx.movementDocument.update({
                where: { id },
                data: { status: 'REJECTED' },
            });
        } else {
            const isLastStep = currentStepNo === approval.totalSteps;
            const nextStatus = STATUS_BY_APPROVED_STEP[currentStepNo] || 'DRAFT';

            if (isLastStep) {
                await tx.approvalRequest.update({
                    where: { id: approval.id },
                    data: { status: 'APPROVED', currentStep: currentStepNo, resolvedAt: now },
                });

                await applyStockImpactOnFinalApproval(tx, doc, userId);

                await tx.movementDocument.update({
                    where: { id },
                    data: { status: nextStatus, postedAt: now },
                });
            } else {
                await tx.approvalRequest.update({
                    where: { id: approval.id },
                    data: { currentStep: currentStepNo + 1 },
                });
                await tx.movementDocument.update({
                    where: { id },
                    data: { status: nextStatus },
                });
            }
        }

        return tx.movementDocument.findFirst({ where: { id }, include: LOST_INCLUDE });
    });
};

module.exports = {
    listLostItems,
    createLost,
    getLostById,
    approveLostAtLevel,
    processLostApprovalStep,
};
