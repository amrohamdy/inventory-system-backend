const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const emailService = require('./email.service');
const { connectRole, normalizeRole } = require('./rbac.service');
const { checkPeriodLock } = require('./periodGuard.service');
const { formatStructuredMovementNotes } = require('../utils/formatMovementNotes');
const { incrementTotalQtyDamage } = require('./stockCumulative.service');
const { getStorage, isLocalDriver } = require('../config/storage');
const path = require('path');
const crypto = require('crypto');

// ── Constants ─────────────────────────────────────────────────────────────────

const APPROVAL_CHAIN = [
    { step: 1, role: 'DEPT_MANAGER', label: 'HOD Approval' },
    { step: 2, role: 'COST_CONTROL', label: 'Cost Control Approval' },
    { step: 3, role: 'FINANCE_MANAGER', label: 'Finance Approval' },
    { step: 4, role: 'GENERAL_MANAGER', label: 'GM Approval' },
];

const STATUS_BY_APPROVED_STEP = {
    1: 'DEPT_APPROVED',
    2: 'COST_CONTROL_APPROVED',
    3: 'FINANCE_APPROVED',
    4: 'APPROVED',
};

/** Stored on approval_steps.accountabilityType for GET_PASS_RETURN workflow approvals. */
const GET_PASS_ACCOUNTABILITY = new Set([
    'EMPLOYEE_DEDUCTION',
    'COMPANY_LOSS',
    'TARGET_HOTEL_COMPENSATION',
]);
const SUGGESTED_ACTIONS = new Set(['EMPLOYEE', 'HOTEL']);

/**
 * Same 4-step chain as manual breakage, with step 1 pre-approved (e.g. dept manager accepted get-pass return).
 * Sets currentStep to 2 so Cost Control is the next actor.
 */
const createMovementApprovalRequest = async (tx, {
    tenantId,
    documentId,
    createdBy,
    requestType,
    deptApproverUserId,
    firstStepComment,
    /** Pre-approved DEPT_MANAGER step: accountability from get-pass return lines (Workflow History). */
    firstStepAccountabilityType,
}) => {
    const now = new Date();
    const comment = firstStepComment || AUTO_APPROVAL_NOTE;
    const rawAccountability =
        typeof firstStepAccountabilityType === 'string' ? firstStepAccountabilityType.trim() : '';
    const step1Accountability = rawAccountability && GET_PASS_ACCOUNTABILITY.has(rawAccountability)
        ? rawAccountability
        : undefined;
    await tx.approvalRequest.create({
        data: {
            tenantId,
            requestType,
            status: 'PENDING',
            documentId,
            currentStep: 2,
            totalSteps: APPROVAL_CHAIN.length,
            createdBy,
            steps: {
                create: APPROVAL_CHAIN.map((c) => ({
                    stepNumber: c.step,
                    requiredRole: connectRole(c.role),
                    status: c.step === 1 ? 'APPROVED' : 'PENDING',
                    ...(c.step === 1
                        ? {
                              actedByUser: { connect: { id: deptApproverUserId } },
                              actedAt: now,
                              comment,
                              // Persist accountability on the auto-approved DEPT_MANAGER step (get-pass returns).
                              ...(step1Accountability
                                  ? { accountabilityType: step1Accountability }
                                  : {}),
                          }
                        : {}),
                })),
            },
        },
    });
};
const AUTO_APPROVAL_NOTE = 'Auto-approved on creation';

/** Cross-department list + approval-chain payload for these roles (tenant-wide). */
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
 * For approver roles, the workflow tab keeps documents the user has already advanced
 * until the record is fully APPROVED (archive).
 * - COST_CONTROL + tab DEPT_APPROVED → DEPT_APPROVED or COST_CONTROL_APPROVED
 * - FINANCE_MANAGER + tab COST_CONTROL_APPROVED → COST_CONTROL_APPROVED or FINANCE_APPROVED
 * - GENERAL_MANAGER + tab FINANCE_APPROVED → FINANCE_APPROVED only
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

/** Dept managers only see their own submissions on the in-flight + approved archive lists. */
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

const breakageListInclude = (user) => {
    const role = user?.role ? normalizeRole(user.role) : '';
    const fullApproval = TENANT_WIDE_MOVEMENT_APPROVAL_ROLES.has(role);
    const base = {
        createdByUser: { select: { firstName: true, lastName: true } },
        getPass: { select: { id: true, passNo: true } },
        _count: { select: { lines: true } },
        lines: { select: { qtyInBaseUnit: true } },
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

const err = (msg, code = 400) => Object.assign(new Error(msg), { statusCode: code });

const buildBreakagePhotoKey = (tenantId, originalName, documentNo) => {
    const ext = path.extname(originalName || '').toLowerCase() || '.jpg';
    if (isLocalDriver()) {
        return `/uploads/attachments/breakage-photo-${documentNo || Date.now()}${ext}`;
    }
    return `tenants/${tenantId}/breakages/${crypto.randomUUID()}${ext}`;
};

const withBreakagePhotoUrl = async (doc) => {
    if (!doc || typeof doc !== 'object') return doc;
    if (!doc.photoKey) return { ...doc, photoUrl: null };
    try {
        const storage = getStorage();
        const photoUrl = await storage.getSignedUrl(doc.photoKey);
        return { ...doc, photoUrl };
    } catch {
        return { ...doc, photoUrl: null };
    }
};

// ── Full include for breakage document ───────────────────────────────────────
const BREAKAGE_INCLUDE = {
    createdByUser: { select: { id: true, firstName: true, lastName: true, email: true } },
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

// Helper: get first approvalRequest from the array
const getApproval = (doc) => doc.approvalRequests || null;

// ── CREATE ────────────────────────────────────────────────────────────────────
const createBreakage = async (data, tenantId, userId, _userRole, photoFile = null) => {
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
    } = data;

    if (!reason?.trim()) throw err('Reason is required for breakage documents.');
    if (lines.length === 0) throw err('At least one line item is required.');
    if (!sourceLocationId) throw err('Source location is required.');
    if (!suggestedAction || !SUGGESTED_ACTIONS.has(String(suggestedAction).trim().toUpperCase())) {
        throw err('Suggested action is required and must be EMPLOYEE or HOTEL.');
    }
    const normalizedSuggestedAction = String(suggestedAction).trim().toUpperCase();

    // Validate location
    const location = await prisma.location.findFirst({ where: { id: sourceLocationId, tenantId } });
    if (!location) throw err('Location not found.', 404);

    // Generate document number
    const yearMonth = new Date().toISOString().slice(2, 7).replace('-', '');
    const prefix = `BRK-${yearMonth}-`;
    const lastDoc = await prisma.movementDocument.findFirst({
        where: { tenantId, documentNo: { startsWith: prefix } },
        orderBy: { documentNo: 'desc' },
    });
    const seq = lastDoc ? (parseInt(lastDoc.documentNo.split('-').pop()) + 1) : 1;
    const documentNo = `${prefix}${seq.toString().padStart(4, '0')}`;
    let photoKey = null;
    if (photoFile) {
        const storage = getStorage();
        photoKey = buildBreakagePhotoKey(tenantId, photoFile.originalname, documentNo);
        await storage.put(photoKey, photoFile.buffer, {
            contentType: photoFile.mimetype,
            originalName: photoFile.originalname,
        });
    }

    // Validate line items exist
    for (const line of lines) {
        const item = await prisma.item.findFirst({ where: { id: line.itemId, tenantId } });
        if (!item) throw err(`Item ${line.itemId} not found.`, 404);
        if (!line.qty || parseFloat(line.qty) <= 0) throw err(`Quantity for item ${item.name} must be positive.`);
    }
    const firstStepAccountabilityType =
        typeof accountabilityType === 'string' && accountabilityType.trim()
            ? accountabilityType.trim()
            : typeof accountability === 'string' && accountability.trim()
                ? accountability.trim()
                : undefined;

    return prisma.$transaction(async (tx) => {
        // INTERNAL manual breakage: enter the same 4-step chain as get-pass return — dept step recorded on
        // creation, document already DEPT_APPROVED so Cost Control is next (timeline + pipeline).
        const doc = await tx.movementDocument.create({
            data: {
                tenantId,
                documentNo,
                movementType: 'BREAKAGE',
                sourceType: 'INTERNAL',
                status: 'DEPT_APPROVED',
                sourceLocationId,
                reason: reason.trim(),
                notes: notes?.trim() || null,
                photoKey,
                suggestedAction: normalizedSuggestedAction,
                responsibleEmployeeName:
                    typeof responsibleEmployeeName === 'string' && responsibleEmployeeName.trim()
                        ? responsibleEmployeeName.trim()
                        : null,
                documentDate: documentDate ? new Date(documentDate) : new Date(),
                createdBy: userId,
                lines: {
                    create: lines.map(l => ({
                        itemId: l.itemId,
                        locationId: l.locationId || sourceLocationId,  // ← per-line location (fallback to doc location)
                        qtyRequested: parseFloat(l.qty),
                        qtyInBaseUnit: parseFloat(l.qty),
                        unitCost: parseFloat(l.unitCost) || 0,
                        totalValue: parseFloat(l.totalValue) || 0,
                        notes: l.notes || null,
                    })),
                },
            },
        });

        await createMovementApprovalRequest(tx, {
            tenantId,
            documentId: doc.id,
            createdBy: userId,
            requestType: 'BREAKAGE',
            deptApproverUserId: userId,
            firstStepComment: AUTO_APPROVAL_NOTE,
            firstStepAccountabilityType,
        });

        const created = await tx.movementDocument.findFirst({ where: { id: doc.id }, include: BREAKAGE_INCLUDE });
        return withBreakagePhotoUrl(created);
    });
};

// ── LIST ──────────────────────────────────────────────────────────────────────
const getBreakages = async (tenantId, query = {}, user = null) => {
    const { skip = 0, take = 20, status, search, sourceType, pipeline } = query;
    const sourceFilter =
        sourceType === 'INTERNAL'
            ? { getPassId: null }
            : sourceType === 'GET_PASS_RETURN'
                ? { getPassId: { not: null } }
                : {};

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

    const where = {
        tenantId,
        movementType: 'BREAKAGE',
        ...statusWhere,
        ...deptManagerScope,
        ...sourceFilter,
        ...(search && {
            OR: [
                { documentNo: { contains: search, mode: 'insensitive' } },
                { reason: { contains: search, mode: 'insensitive' } },
            ],
        }),
    };

    const skipN = Number.parseInt(String(skip), 10) || 0;
    const takeN = Number.parseInt(String(take), 10) || 20;

    const listInclude = breakageListInclude(user);

    const [rawDocuments, total] = await Promise.all([
        prisma.movementDocument.findMany({
            where,
            skip: skipN,
            take: takeN,
            orderBy: { createdAt: 'desc' },
            include: listInclude,
        }),
        prisma.movementDocument.count({ where }),
    ]);

    const documents = await Promise.all(rawDocuments.map(async (d) => {
        const totalQtyDamaged = (d.lines ?? []).reduce(
            (sum, line) => sum + Number(line.qtyInBaseUnit || 0),
            0,
        );
        const { lines: _lines, ...rest } = d;
        const ar = d.approvalRequests;
        if (!ar) {
            return withBreakagePhotoUrl({ ...rest, totalQtyDamaged, approvalRequests: [] });
        }
        if (ar.steps) {
            return withBreakagePhotoUrl({
                ...rest,
                totalQtyDamaged,
                approvalRequests: [
                    {
                        id: ar.id,
                        status: ar.status,
                        currentStep: ar.currentStep,
                        totalSteps: ar.totalSteps,
                        createdAt: ar.createdAt,
                        steps: ar.steps,
                    },
                ],
            });
        }
        return withBreakagePhotoUrl({
            ...rest,
            totalQtyDamaged,
            approvalRequests: [
                {
                    id: ar.id,
                    status: ar.status,
                    currentStep: ar.currentStep,
                    totalSteps: ar.totalSteps,
                    createdAt: ar.createdAt,
                },
            ],
        });
    }));

    return { documents, total };
};

// ── GET BY ID ─────────────────────────────────────────────────────────────────
const getBreakageById = async (id, tenantId) => {
    const doc = await prisma.movementDocument.findFirst({
        where: { id, tenantId, movementType: 'BREAKAGE' },
        include: BREAKAGE_INCLUDE,
    });
    if (!doc) throw err('Breakage document not found.', 404);
    return withBreakagePhotoUrl(doc);
};

// ── SUBMIT FOR APPROVAL ───────────────────────────────────────────────────────
const submitBreakage = async (id, tenantId, userId) => {
    const doc = await getBreakageById(id, tenantId);

    if (doc.status !== 'DRAFT') throw err(`Cannot submit document in ${doc.status} status.`);
    if (doc.lines.length === 0) throw err('Cannot submit empty document.');

    return prisma.$transaction(async (tx) => {
        await tx.movementDocument.update({
            where: { id },
            // Keep DRAFT until first approval, then move through explicit role-based statuses.
            data: { status: 'DRAFT' },
        });
        // Mark approval request as active
        const approval = getApproval(doc);
        if (approval) {
            await tx.approvalRequest.update({
                where: { id: approval.id },
                data: { currentStep: 1 },
            });

            // Send email to appropriate approver
            try {
                // Find users with the first step role to send an email
                // In a production system this would target the specific manager 
                const chain = APPROVAL_CHAIN.find(c => c.step === 1);
                const approvers = await tx.tenantMember.findMany({
                    where: { tenantId, role: { code: chain.role }, isActive: true, user: { isActive: true } },
                    select: { user: { select: { email: true } } }
                });

                const submitter = await tx.user.findUnique({ where: { id: userId } });

                for (const app of approvers) {
                    await emailService.sendApprovalPendingNotification(approval, submitter, app.user.email);
                }
            } catch (err) {
                console.error("Failed to send approval email:", err);
            }
        }
        return tx.movementDocument.findFirst({ where: { id }, include: BREAKAGE_INCLUDE });
    });
};

// ── PROCESS APPROVAL STEP ─────────────────────────────────────────────────────
const processApprovalStep = async (id, tenantId, userId, userRole, action, comment, accountability) => {
    const doc = await getBreakageById(id, tenantId);

    // ── Lock checks ───────────────────────────────────────────────────────────
    if (doc.status === 'APPROVED')
        throw err('Document is already APPROVED and locked. No further actions allowed.');
    if (doc.status === 'VOID')
        throw err('Document has been voided.');
    if (doc.status === 'REJECTED')
        throw err(`Document is REJECTED. Resubmit from draft to continue workflow.`);

    const approval = getApproval(doc);
    if (!approval) throw err('Approval record not found.', 404);

    const currentStepNo = approval.currentStep;
    const chain = APPROVAL_CHAIN.find(c => c.step === currentStepNo);

    if (!chain) throw err('All approval steps already completed.');

    // ── Role enforcement ──────────────────────────────────────────────────────
    if (userRole !== chain.role && userRole !== 'ADMIN' && userRole !== 'ORG_MANAGER') {
        throw err(`Step ${currentStepNo} requires role ${chain.role}. Your role: ${userRole}`);
    }

    // ── Out-of-order guard ────────────────────────────────────────────────────
    const step = approval.steps.find(s => s.stepNumber === currentStepNo);
    if (!step) throw err(`Step ${currentStepNo} not found in approval chain.`, 404);
    if (step.status !== 'PENDING') throw err(`Step ${currentStepNo} has already been ${step.status}.`);

    // Ensure all previous steps are approved
    const prevSteps = approval.steps.filter(s => s.stepNumber < currentStepNo);
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

        // Update the current step
        await tx.approvalStep.update({
            where: { id: step.id },
            data: stepUpdate,
        });

        if (action === 'REJECT') {
            // Reject: return document to DRAFT, reset approval
            await tx.approvalRequest.update({
                where: { id: approval.id },
                data: { status: 'REJECTED', resolvedAt: now },
            });
            await tx.movementDocument.update({
                where: { id },
                data: { status: 'REJECTED' },
            });
        } else {
            // Approve: advance to next step or trigger final posting
            const isLastStep = currentStepNo === approval.totalSteps;
            const nextStatus = STATUS_BY_APPROVED_STEP[currentStepNo] || 'DRAFT';

            if (isLastStep) {
                // ── Final Approval (GM): finalize + post ledger ───────────────
                await tx.approvalRequest.update({
                    where: { id: approval.id },
                    data: { status: 'APPROVED', currentStep: currentStepNo, resolvedAt: now },
                });

                // Post to ledger (inline to use same tx)
                await _postBreakageInTransaction(tx, doc, tenantId, userId);

                await tx.movementDocument.update({
                    where: { id },
                    data: { status: nextStatus, postedAt: now },
                });
            } else {
                // Advance to next step
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

        return tx.movementDocument.findFirst({ where: { id }, include: BREAKAGE_INCLUDE });
    });
};

// ── Internal: post breakage inside transaction ────────────────────────────────
const _postBreakageInTransaction = async (tx, doc, tenantId, userId) => {
    // ============================================================================
    // 🚨 ARCHITECTURAL GUARD: STRICT LEDGER CONSISTENCY RULE 🚨
    // `StockBalance` mutation MUST be strictly paired with `InventoryLedger` creation
    // inside this transaction `tx`. Bypassing this breaks financial reconciliation.
    // ============================================================================

    // Double-post guard
    const existing = await tx.inventoryLedger.findFirst({
        where: { tenantId, referenceId: doc.id },
    });
    if (existing) throw err('Document has already been posted to ledger. Double-posting prevented.');

    const isGetPassReturn = doc.sourceType === 'GET_PASS_RETURN';

    if (isGetPassReturn) {
        // Physical qty was already removed from on-hand when the dept manager accepted the return.
        // Final GM approval only records the financial breakage (ledger), paired with no further stock change.
        for (const line of doc.lines) {
            const qty = parseFloat(line.qtyInBaseUnit);
            if (qty <= 0) continue;
            const unitCost = parseFloat(line.unitCost || 0);
            const lossValue = qty * unitCost;

            await tx.inventoryLedger.create({
                data: {
                    tenantId,
                    itemId: line.itemId,
                    locationId: line.locationId,
                    movementType: 'BREAKAGE',
                    qtyOut: qty,
                    qtyIn: 0,
                    unitCost,
                    totalValue: lossValue,
                    referenceType: 'BREAKAGE',
                    referenceId: doc.id,
                    referenceNo: doc.documentNo,
                    notes: doc.reason,
                    createdBy: userId,
                },
            });
            await incrementTotalQtyDamage(tx, tenantId, line.itemId, line.locationId, qty);
        }
        return;
    }

    for (const line of doc.lines) {
        const itemId = line.itemId;
        const locationId = line.locationId;
        const qty = parseFloat(line.qtyInBaseUnit);

        const stockKey = { tenantId, itemId, locationId };

        const currentStock = await tx.stockBalance.findUnique({
            where: { tenantId_itemId_locationId: stockKey },
        });

        const qtyBefore = currentStock ? parseFloat(currentStock.qtyOnHand) : 0;
        const wacBefore = currentStock ? parseFloat(currentStock.wacUnitCost) : 0;

        if (qtyBefore < qty) {
            throw err(
                `Insufficient stock for ${line.item?.name || itemId} at location. ` +
                `Available: ${qtyBefore}, Requested: ${qty}`
            );
        }

        const lossValue = qty * wacBefore;

        // Ledger entry
        await tx.inventoryLedger.create({
            data: {
                tenantId,
                itemId,
                locationId,
                movementType: 'BREAKAGE',
                qtyOut: qty,
                qtyIn: 0,
                unitCost: wacBefore,
                totalValue: lossValue,
                referenceType: 'BREAKAGE',
                referenceId: doc.id,
                referenceNo: doc.documentNo,
                notes: doc.reason,
                createdBy: userId,
            },
        });

        // Update stock balance (on-hand reduction + cumulative damage counter)
        await tx.stockBalance.update({
            where: { tenantId_itemId_locationId: stockKey },
            data: {
                qtyOnHand: { decrement: qty },
                totalQtyDamage: { increment: qty },
            },
        });
    }
};

/**
 * Get-pass return breakage (and any doc with an ApprovalRequest) must use {@link processApprovalStep}
 * via POST /breakage/:id/approve. Legacy approve-dept/cost/… routes apply only to purely INTERNAL documents
 * without an approval request (edge / migrated data).
 */
const shouldUseUnifiedBreakageApproval = (doc) =>
    doc.sourceType === 'GET_PASS_RETURN' || doc.approvalRequests != null;

const BREAKAGE_MANUAL_FLOW = [
    { status: 'DRAFT', nextStatus: 'DEPT_APPROVED', role: 'DEPT_MANAGER' },
    { status: 'DEPT_APPROVED', nextStatus: 'COST_CONTROL_APPROVED', role: 'COST_CONTROL' },
    { status: 'COST_CONTROL_APPROVED', nextStatus: 'FINANCE_APPROVED', role: 'FINANCE_MANAGER' },
    { status: 'FINANCE_APPROVED', nextStatus: 'APPROVED', role: 'GENERAL_MANAGER' },
];

const ensureCanApproveBreakageManual = (doc, userRole) => {
    const current = BREAKAGE_MANUAL_FLOW.find((s) => s.status === doc.status);
    if (!current) throw err(`Document status ${doc.status} is not approvable.`);
    if (userRole !== current.role && userRole !== 'ADMIN' && userRole !== 'ORG_MANAGER') {
        throw err(`Status ${doc.status} requires role ${current.role}.`, 403);
    }
    return current;
};

const approveBreakageAtLevel = async (id, tenantId, userId, userRole, expectedStatus, body = {}) => {
    const doc = await getBreakageById(id, tenantId);

    if (shouldUseUnifiedBreakageApproval(doc)) {
        return processApprovalStep(
            id,
            tenantId,
            userId,
            userRole,
            'APPROVE',
            body.comment,
            body.accountability,
        );
    }

    if (doc.sourceType !== 'INTERNAL') throw err('Only internal breakage documents can be approved manually.');
    if (doc.status !== expectedStatus) throw err(`Document must be in ${expectedStatus} status.`);
    const current = ensureCanApproveBreakageManual(doc, userRole);
    const isFinal = current.nextStatus === 'APPROVED';

    if (isFinal) {
        await checkPeriodLock(tenantId, doc.documentDate || doc.createdAt || new Date());
    }

    return prisma.$transaction(async (tx) => {
        if (isFinal) {
            await _postBreakageInTransaction(tx, doc, tenantId, userId);
        }

        return tx.movementDocument.update({
            where: { id: doc.id },
            data: {
                status: current.nextStatus,
                ...(isFinal ? { postedAt: new Date() } : {}),
            },
            include: BREAKAGE_INCLUDE,
        });
    });
};

// ── UPLOAD ATTACHMENT ─────────────────────────────────────────────────────────
const addAttachment = async (id, tenantId, attachmentMeta) => {
    const doc = await getBreakageById(id, tenantId);

    // Lock check
    if (doc.status === 'APPROVED' || doc.status === 'VOID') {
        throw err(`Cannot add attachments to a ${doc.status} document.`);
    }

    // Attachments stored as JSON field on the document
    // We extend the existing JSON array in attachmentUrl field
    // Field: attachmentUrl stores JSON array of attachment objects
    let attachments = [];
    try {
        attachments = doc.attachmentUrl ? JSON.parse(doc.attachmentUrl) : [];
    } catch {
        attachments = [];
    }

    attachments.push({
        ...attachmentMeta,
        uploadedAt: new Date().toISOString(),
    });

    return prisma.movementDocument.update({
        where: { id },
        data: { attachmentUrl: JSON.stringify(attachments) },
        include: BREAKAGE_INCLUDE,
    });
};

// ── EVIDENCE JSON ─────────────────────────────────────────────────────────────
const getEvidence = async (id, tenantId) => {
    const doc = await getBreakageById(id, tenantId);

    // Approval history
    const approvalHistory = (getApproval(doc)?.steps || []).map(s => ({
        stepNumber: s.stepNumber,
        role: s.requiredRole?.code ?? s.requiredRole,
        label: APPROVAL_CHAIN.find(c => c.step === s.stepNumber)?.label,
        status: s.status,
        actedBy: s.actedByUser
            ? `${s.actedByUser.firstName} ${s.actedByUser.lastName}`
            : null,
        actedByUserId: s.actedBy,
        actedAt: s.actedAt,
        comment: s.comment,
    }));

    // Attachments
    let attachments = [];
    try {
        attachments = doc.attachmentUrl ? JSON.parse(doc.attachmentUrl) : [];
    } catch { attachments = []; }

    // Ledger entries
    const ledgerEntries = await prisma.inventoryLedger.findMany({
        where: { tenantId, referenceId: id },
        include: {
            item: { select: { id: true, name: true, barcode: true } },
            location: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
    });

    // Stock impact per line
    const stockImpact = await Promise.all(doc.lines.map(async (line) => {
        const ledger = ledgerEntries.find(e => e.itemId === line.itemId);
        const current = await prisma.stockBalance.findUnique({
            where: {
                tenantId_itemId_locationId: {
                    tenantId,
                    itemId: line.itemId,
                    locationId: line.locationId,
                },
            },
        });

        const qtyDeducted = parseFloat(line.qtyInBaseUnit);
        const wacUsed = ledger ? parseFloat(ledger.unitCost) : null;
        const qtyAfter = current ? parseFloat(current.qtyOnHand) : null;
        const qtyBefore = qtyAfter !== null ? qtyAfter + qtyDeducted : null;
        const totalLoss = wacUsed !== null ? qtyDeducted * wacUsed : null;

        return {
            itemId: line.item.id,
            itemName: line.item.name,
            barcode: line.item.barcode,
            locationId: line.location.id,
            locationName: line.location.name,
            qtyBefore,
            qtyDeducted,
            qtyAfter,
            wacAtPosting: wacUsed,
            totalLoss,
        };
    }));

    const totalLossValue = stockImpact.reduce((s, i) => s + (i.totalLoss || 0), 0);

    return {
        header: {
            documentNo: doc.documentNo,
            status: doc.status,
            reason: doc.reason,
            notes: formatStructuredMovementNotes(doc.notes) ?? doc.notes,
            documentDate: doc.documentDate,
            createdBy: doc.createdByUser
                ? `${doc.createdByUser.firstName} ${doc.createdByUser.lastName}`
                : null,
            createdByRole: null,
            createdByEmail: doc.createdByUser?.email,
            createdAt: doc.createdAt,
            submittedAt: doc.updatedAt, // approximation
            postedAt: doc.postedAt,
            sourceLocation: doc.sourceLocationId,
        },
        lineItems: doc.lines.map(l => ({
            itemId: l.item.id,
            itemName: l.item.name,
            barcode: l.item.barcode,
            qty: parseFloat(l.qtyInBaseUnit),
            notes: formatStructuredMovementNotes(l.notes) ?? l.notes,
        })),
        approvalChainDefinition: APPROVAL_CHAIN,
        approvalHistory,
        approvalSummary: {
            currentStep: getApproval(doc)?.currentStep,
            totalSteps: getApproval(doc)?.totalSteps,
            overallStatus: getApproval(doc)?.status,
        },
        attachments,
        ledgerEntries: ledgerEntries.map(e => ({
            id: e.id,
            itemName: e.item?.name,
            locationName: e.location?.name,
            movementType: e.movementType,
            qtyOut: parseFloat(e.qtyOut),
            unitCost: parseFloat(e.unitCost),
            totalValue: parseFloat(e.totalValue),
            createdAt: e.createdAt,
            referenceNo: e.referenceNo,
        })),
        stockImpactSummary: {
            perItem: stockImpact,
            totalLossValue: parseFloat(totalLossValue.toFixed(4)),
            currency: 'SAR',
        },
        generatedAt: new Date().toISOString(),
    };
};

// ── VOID (admin only, only DRAFT/REJECTED) ────────────────────────────────────
const voidBreakage = async (id, tenantId, userId) => {
    const doc = await getBreakageById(id, tenantId);

    if (doc.status === 'APPROVED')
        throw err('Cannot void an APPROVED document. Approved documents are immutable.');
    if (doc.status === 'VOID')
        throw err('Document is already voided.');

    return prisma.movementDocument.update({
        where: { id },
        data: { status: 'VOID', voidedAt: new Date() },
        include: BREAKAGE_INCLUDE,
    });
};

module.exports = {
    createBreakage,
    getBreakages,
    getBreakageById,
    submitBreakage,
    approveBreakageAtLevel,
    processApprovalStep,
    addAttachment,
    getEvidence,
    voidBreakage,
    APPROVAL_CHAIN,
    STATUS_BY_APPROVED_STEP,
    createMovementApprovalRequest,
};
