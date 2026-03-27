const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const postingService = require('./posting.service');
const { checkPeriodLock } = require('./periodGuard.service');
const { logAction, EntityType } = require('./auditTrail.service');
const { generateDocNumber } = require('./docNumbering.service');

/**
 * Creates a new Stock Count Session for a given location.
 * Takes a static snapshot of current Stock Balances and WAC.
 */
const createSession = async (tenantId, locationId, createdBy, notes, countDate) => {
    // ── Period Guard ─────────────────────────────────────────────────────────
    const sessionDate = countDate ? new Date(countDate) : new Date();
    await checkPeriodLock(tenantId, sessionDate);
    // ─────────────────────────────────────────────────────────────────────────

    // Check if location exists
    const location = await prisma.location.findUnique({
        where: { id: locationId, tenantId }
    });
    if (!location) throw new Error('Location not found');

    // Generate unique session number
    const dateStr = new Date().toISOString().slice(2, 7).replace('-', '');
    const count = await prisma.stockCountSession.count({ where: { tenantId } });
    const sessionNo = `CNT-${dateStr}-${String(count + 1).padStart(4, '0')}`;

    // Get current stock balances for this location to freeze book quantities
    const balances = await prisma.stockBalance.findMany({
        where: { tenantId, locationId },
        include: { item: true }
    });

    const activePasses = await prisma.getPassLine.findMany({
        where: {
            locationId,
            status: { in: ['OUT', 'PARTIALLY_RETURNED'] },
            getPass: { tenantId }
        }
    });
    
    const loanedQuantities = activePasses.reduce((acc, pass) => {
        acc[pass.itemId] = (acc[pass.itemId] || 0) + (Number(pass.qty) - Number(pass.qtyReturned));
        return acc;
    }, {});

    // We take a snapshot of all items stored in this location
    const sessionLines = balances.map(b => ({
        itemId: b.itemId,
        bookQty: Number(b.qtyOnHand),
        qtyOnLoan: loanedQuantities[b.itemId] || 0,
        wacUnitCost: Number(b.wacUnitCost),
        varianceQty: 0,
        varianceValue: 0
    }));

    const session = await prisma.stockCountSession.create({
        data: {
            tenantId,
            locationId,
            sessionNo,
            createdBy,
            notes,
            lines: {
                create: sessionLines
            }
        },
        include: { lines: { include: { item: true } }, createdByUser: true }
    });

    return session;
};

const getSessions = async (tenantId, params = {}) => {
    const { status, locationId, page = 1, limit = 50 } = params;
    const skip = (page - 1) * limit;

    const where = { tenantId };
    if (status) where.status = status;
    if (locationId) where.locationId = locationId;

    const [data, total] = await Promise.all([
        prisma.stockCountSession.findMany({
            where,
            include: { location: true, createdByUser: true },
            orderBy: { createdAt: 'desc' },
            skip,
            take: Number(limit)
        }),
        prisma.stockCountSession.count({ where })
    ]);

    return { data, total, page: Number(page), limit: Number(limit) };
};

const getSessionById = async (id, tenantId) => {
    const session = await prisma.stockCountSession.findUnique({
        where: { id, tenantId },
        include: {
            location: true,
            createdByUser: true,
            lines: {
                include: { item: true },
                orderBy: { item: { name: 'asc' } }
            },
            approvalRequest: {
                include: {
                    steps: {
                        include: { actedByUser: true },
                        orderBy: { stepNumber: 'asc' }
                    }
                }
            }
        }
    });

    if (!session) throw new Error('Session not found');
    return session;
};

/**
 * Updates counted quantities for a session. Supports partial saves.
 * Calculates variance immediately based on static unitCost.
 */
const updateCountLines = async (id, tenantId, lineUpdates) => {
    const session = await getSessionById(id, tenantId);
    if (!['DRAFT', 'COUNTING'].includes(session.status)) {
        throw new Error('Can only update lines when status is DRAFT or COUNTING');
    }

    await prisma.$transaction(async (tx) => {

        for (const update of lineUpdates) {
            const line = session.lines.find(l => l.itemId === update.itemId);
            if (!line) continue;

            const countedQty = update.countedQty !== null ? Number(update.countedQty) : null;

            if (countedQty !== null) {
                const varianceQty = countedQty - Number(line.bookQty);
                const varianceValue = varianceQty * Number(line.wacUnitCost);

                await tx.stockCountLine.update({
                    where: { id: line.id },
                    data: {
                        countedQty,
                        varianceQty,
                        varianceValue
                    }
                });
            } else {
                // If setting back to null (clearing the field)
                await tx.stockCountLine.update({
                    where: { id: line.id },
                    data: {
                        countedQty: null,
                        varianceQty: 0,
                        varianceValue: 0
                    }
                });
            }
        }
    });

    return getSessionById(id, tenantId);
};

const submitForApproval = async (id, tenantId, userId) => {
    const session = await getSessionById(id, tenantId);

    if (!['DRAFT', 'COUNTING'].includes(session.status)) {
        throw new Error('Can only submit DRAFT or COUNTING sessions');
    }

    // Check if any items are uncounted
    const uncounted = session.lines.filter(l => l.countedQty === null);
    if (uncounted.length > 0) {
        throw new Error(`Cannot submit because ${uncounted.length} items have not been counted. Please enter 0 or the actual quantity.`);
    }

    const approvalRequest = await prisma.$transaction(async (tx) => {
        // Create Approval Request (3-steps: HOD -> Cost -> Finance)
        const request = await tx.approvalRequest.create({
            data: {
                tenantId,
                requestType: 'COUNT_ADJUSTMENT',
                StockCountSession: { connect: { id } },
                totalSteps: 3,
                createdBy: userId,
                steps: {
                    create: [
                        { stepNumber: 1, requiredRole: 'DEPT_MANAGER' },
                        { stepNumber: 2, requiredRole: 'COST_CONTROL' },
                        { stepNumber: 3, requiredRole: 'FINANCE_MANAGER' }
                    ]
                }
            }
        });

        await tx.stockCountSession.update({
            where: { id },
            data: { status: 'PENDING_APPROVAL', approvalRequestId: request.id }
        });

        return request;
    });

    return approvalRequest;
};

const processApproval = async (id, tenantId, user, comment, isApproved) => {
    const session = await getSessionById(id, tenantId);
    if (session.status !== 'PENDING_APPROVAL' || !session.approvalRequest) {
        throw new Error('Session is not pending approval');
    }

    const reqId = session.approvalRequestId;
    const request = session.approvalRequest;

    const currentStepNum = request.currentStep + 1;
    const step = request.steps.find(s => s.stepNumber === currentStepNum);

    if (!step) throw new Error('No pending approval step found');
    if (step.requiredRole !== user.role && user.role !== 'ADMIN') {
        throw new Error(`Unauthorized. Step requires role: ${step.requiredRole}`);
    }

    if (!isApproved) {
        // REJECT
        await prisma.$transaction(async (tx) => {
            await tx.approvalStep.update({
                where: { id: step.id },
                data: { status: 'REJECTED', actedBy: user.id, actedAt: new Date(), comment }
            });
            await tx.approvalRequest.update({
                where: { id: reqId },
                data: { status: 'REJECTED', resolvedAt: new Date() }
            });
            await tx.stockCountSession.update({
                where: { id },
                data: { status: 'REJECTED' }
            });
        });
        return { success: true, status: 'REJECTED' };
    } else {
        // APPROVE
        const isFinal = currentStepNum === request.totalSteps;

        await prisma.$transaction(async (tx) => {
            await tx.approvalStep.update({
                where: { id: step.id },
                data: { status: 'APPROVED', actedBy: user.id, actedAt: new Date(), comment }
            });

            if (isFinal) {
                await tx.approvalRequest.update({
                    where: { id: reqId },
                    data: { status: 'APPROVED', currentStep: currentStepNum, resolvedAt: new Date() }
                });
            } else {
                await tx.approvalRequest.update({
                    where: { id: reqId },
                    data: { currentStep: currentStepNum }
                });
            }
        });

        if (isFinal) {
            // Trigger posting engine
            await postingService.postStockCount(id, tenantId, user.id);
            return { success: true, status: 'POSTED' };
        }

        return { success: true, status: 'PENDING_APPROVAL' };
    }
};

const voidSession = async (id, tenantId, userId) => {
    const session = await getSessionById(id, tenantId);

    if (session.status === 'POSTED') {
        throw new Error('Cannot void a session that is already POSTED');
    }

    await prisma.stockCountSession.update({
        where: { id },
        data: { status: 'VOID' }
    });

    return { success: true };
};

module.exports = {
    createSession,
    getSessions,
    getSessionById,
    updateCountLines,
    submitForApproval,
    processApproval,
    voidSession
};
