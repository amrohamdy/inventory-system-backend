const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const emailService = require('./email.service');

// ── Constants ─────────────────────────────────────────────────────────────────

const APPROVAL_CHAIN = [
    { step: 1, role: 'DEPT_MANAGER', label: 'HOD Approval' },
    { step: 2, role: 'COST_CONTROL', label: 'Cost Control Approval' },
    { step: 3, role: 'FINANCE_MANAGER', label: 'Finance Approval' },
];

const err = (msg, code = 400) => Object.assign(new Error(msg), { statusCode: code });

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
                },
            },
        },
    },
};

// Helper: get first approvalRequest from the array
const getApproval = (doc) => doc.approvalRequests?.[0] || null;

// ── CREATE ────────────────────────────────────────────────────────────────────
const createBreakage = async (data, tenantId, userId) => {
    const { lines = [], reason, notes, sourceLocationId, documentDate } = data;

    if (!reason?.trim()) throw err('Reason is required for breakage documents.');
    if (lines.length === 0) throw err('At least one line item is required.');
    if (!sourceLocationId) throw err('Source location is required.');

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

    // Validate line items exist
    for (const line of lines) {
        const item = await prisma.item.findFirst({ where: { id: line.itemId, tenantId } });
        if (!item) throw err(`Item ${line.itemId} not found.`, 404);
        if (!line.qty || parseFloat(line.qty) <= 0) throw err(`Quantity for item ${item.name} must be positive.`);
    }

    return prisma.$transaction(async (tx) => {
        // Create the movement document
        const doc = await tx.movementDocument.create({
            data: {
                tenantId,
                documentNo,
                movementType: 'BREAKAGE',
                status: 'DRAFT',
                sourceLocationId,
                reason: reason.trim(),
                notes: notes?.trim() || null,
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

        // Create 3-step approval request
        await tx.approvalRequest.create({
            data: {
                tenantId,
                requestType: 'BREAKAGE',
                status: 'PENDING',
                documentId: doc.id,
                currentStep: 0,
                totalSteps: 3,
                createdBy: userId,
                steps: {
                    create: APPROVAL_CHAIN.map(c => ({
                        stepNumber: c.step,
                        requiredRole: c.role,
                        status: 'PENDING',
                    })),
                },
            },
        });

        return tx.movementDocument.findFirst({ where: { id: doc.id }, include: BREAKAGE_INCLUDE });
    });
};

// ── LIST ──────────────────────────────────────────────────────────────────────
const getBreakages = async (tenantId, query = {}) => {
    const { skip = 0, take = 20, status, search } = query;

    const where = {
        tenantId,
        movementType: 'BREAKAGE',
        ...(status && { status }),
        ...(search && {
            OR: [
                { documentNo: { contains: search, mode: 'insensitive' } },
                { reason: { contains: search, mode: 'insensitive' } },
            ],
        }),
    };

    const [documents, total] = await Promise.all([
        prisma.movementDocument.findMany({
            where,
            skip: parseInt(skip),
            take: parseInt(take),
            orderBy: { createdAt: 'desc' },
            include: {
                createdByUser: { select: { firstName: true, lastName: true } },
                approvalRequests: { select: { status: true, currentStep: true, totalSteps: true }, take: 1 },
                _count: { select: { lines: true } },
            },
        }),
        prisma.movementDocument.count({ where }),
    ]);

    return { documents, total };
};

// ── GET BY ID ─────────────────────────────────────────────────────────────────
const getBreakageById = async (id, tenantId) => {
    const doc = await prisma.movementDocument.findFirst({
        where: { id, tenantId, movementType: 'BREAKAGE' },
        include: BREAKAGE_INCLUDE,
    });
    if (!doc) throw err('Breakage document not found.', 404);
    return doc;
};

// ── SUBMIT FOR APPROVAL ───────────────────────────────────────────────────────
const submitBreakage = async (id, tenantId, userId) => {
    const doc = await getBreakageById(id, tenantId);

    if (doc.status !== 'DRAFT') throw err(`Cannot submit document in ${doc.status} status.`);
    if (doc.lines.length === 0) throw err('Cannot submit empty document.');

    return prisma.$transaction(async (tx) => {
        await tx.movementDocument.update({
            where: { id },
            data: { status: 'PENDING_APPROVAL' },
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
                    where: { tenantId, role: chain.role, isActive: true, user: { isActive: true } },
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
const processApprovalStep = async (id, tenantId, userId, userRole, action, comment) => {
    const doc = await getBreakageById(id, tenantId);

    // ── Lock checks ───────────────────────────────────────────────────────────
    if (doc.status === 'POSTED')
        throw err('Document is already POSTED and locked. No further actions allowed.');
    if (doc.status === 'VOID')
        throw err('Document has been voided.');
    if (doc.status !== 'PENDING_APPROVAL')
        throw err(`Document must be in PENDING_APPROVAL status. Current: ${doc.status}`);

    const approval = getApproval(doc);
    if (!approval) throw err('Approval record not found.', 404);

    const currentStepNo = approval.currentStep;
    const chain = APPROVAL_CHAIN.find(c => c.step === currentStepNo);

    if (!chain) throw err('All approval steps already completed.');

    // ── Role enforcement ──────────────────────────────────────────────────────
    if (userRole !== chain.role && userRole !== 'ADMIN') {
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

    return prisma.$transaction(async (tx) => {
        // Update the current step
        await tx.approvalStep.update({
            where: { id: step.id },
            data: {
                status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
                actedBy: userId,
                actedAt: now,
                comment: comment?.trim() || null,
            },
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

            if (isLastStep) {
                // ── Final Approval: Post the document ─────────────────────────
                await tx.approvalRequest.update({
                    where: { id: approval.id },
                    data: { status: 'APPROVED', currentStep: currentStepNo, resolvedAt: now },
                });

                // Post to ledger (inline to use same tx)
                await _postBreakageInTransaction(tx, doc, tenantId, userId);

                await tx.movementDocument.update({
                    where: { id },
                    data: { status: 'POSTED', postedAt: now },
                });
            } else {
                // Advance to next step
                await tx.approvalRequest.update({
                    where: { id: approval.id },
                    data: { currentStep: currentStepNo + 1 },
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

        // Update stock balance
        await tx.stockBalance.update({
            where: { tenantId_itemId_locationId: stockKey },
            data: { qtyOnHand: { decrement: qty } },
        });
    }
};

// ── UPLOAD ATTACHMENT ─────────────────────────────────────────────────────────
const addAttachment = async (id, tenantId, attachmentMeta) => {
    const doc = await getBreakageById(id, tenantId);

    // Lock check
    if (doc.status === 'POSTED' || doc.status === 'VOID') {
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
        role: s.requiredRole,
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
            notes: doc.notes,
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
            notes: l.notes,
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

    if (doc.status === 'POSTED')
        throw err('Cannot void a POSTED document. POSTED documents are immutable.');
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
    processApprovalStep,
    addAttachment,
    getEvidence,
    voidBreakage,
    APPROVAL_CHAIN,
};
