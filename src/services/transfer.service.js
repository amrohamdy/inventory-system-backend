'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const emailService = require('./email.service');
const {
    createStoreTransferApprovalRequest,
    processStoreTransferApproval,
    transferStatusForActiveStep,
} = require('./approvalChain.service');

// ─── Auto-number ──────────────────────────────────────────────────────────────

const generateTransferNo = async (tenantId) => {
    const prefix = `TRF-${new Date().toISOString().slice(0, 7).replace('-', '')}`;
    const last = await prisma.storeTransfer.findFirst({
        where: { tenantId, transferNo: { startsWith: prefix } },
        orderBy: { transferNo: 'desc' },
        select: { transferNo: true },
    });
    const seq = last ? parseInt(last.transferNo.split('-').pop()) + 1 : 1;
    return `${prefix}-${String(seq).padStart(4, '0')}`;
};

// ─── Guards ───────────────────────────────────────────────────────────────────

const findTransfer = async (id, tenantId) => {
    const trf = await prisma.storeTransfer.findFirst({
        where: { id, tenantId },
        include: {
            lines: true,
            sourceLocation: { select: { name: true } },
            destLocation: { select: { name: true } },
        },
    });
    if (!trf) throw Object.assign(new Error('Transfer not found'), { status: 404 });
    return trf;
};

const assertStatus = (trf, ...allowed) => {
    if (!allowed.includes(trf.status))
        throw Object.assign(
            new Error(`Transfer must be in ${allowed.join(' or ')} status, currently ${trf.status}`),
            { status: 422 }
        );
};

const assertLocked = (trf) => {
    const immutable = [
        'PENDING_DEPT',
        'PENDING_FINANCE',
        'PENDING_FINAL',
        'SUBMITTED',
        'APPROVED',
        'IN_TRANSIT',
        'RECEIVED',
        'CLOSED',
        'REJECTED',
    ];
    if (immutable.includes(trf.status))
        throw Object.assign(
            new Error(`Transfer is locked (status: ${trf.status}) and cannot be modified`),
            { status: 423 }
        );
};

// ─── CRUD ─────────────────────────────────────────────────────────────────────

const createTransfer = async ({ tenantId, userId, sourceLocationId, destLocationId, transferDate, requiredBy, reason, notes, lines = [] }) => {
    if (!sourceLocationId) throw Object.assign(new Error('sourceLocationId is required'), { status: 400 });
    if (!destLocationId) throw Object.assign(new Error('destLocationId is required'), { status: 400 });
    if (sourceLocationId === destLocationId) throw Object.assign(new Error('Source and destination must be different locations'), { status: 400 });
    if (lines.length === 0) throw Object.assign(new Error('At least one line is required'), { status: 400 });

    const transferNo = await generateTransferNo(tenantId);

    return prisma.storeTransfer.create({
        data: {
            tenantId,
            transferNo,
            sourceLocationId,
            destLocationId,
            requestedBy: userId,
            transferDate: transferDate ? new Date(transferDate) : new Date(),
            requiredBy: requiredBy ? new Date(requiredBy) : null,
            reason,
            notes,
            lines: {
                create: lines.map(l => ({
                    itemId: l.itemId,
                    uomId: l.uomId,
                    requestedQty: l.requestedQty,
                    notes: l.notes,
                })),
            },
        },
        include: { lines: true },
    });
};

const updateTransfer = async (id, tenantId, { sourceLocationId, destLocationId, requiredBy, reason, notes, lines }) => {
    const trf = await findTransfer(id, tenantId);
    assertLocked(trf);
    assertStatus(trf, 'DRAFT');

    return prisma.$transaction(async (tx) => {
        await tx.storeTransfer.update({
            where: { id },
            data: {
                sourceLocationId,
                destLocationId,
                requiredBy: requiredBy ? new Date(requiredBy) : undefined,
                reason,
                notes,
                updatedAt: new Date(),
            },
        });
        if (lines) {
            await tx.storeTransferLine.deleteMany({ where: { transferId: id } });
            if (lines.length === 0) throw Object.assign(new Error('At least one line is required'), { status: 400 });
            await tx.storeTransferLine.createMany({
                data: lines.map(l => ({ transferId: id, itemId: l.itemId, uomId: l.uomId, requestedQty: l.requestedQty, notes: l.notes })),
            });
        }
        return tx.storeTransfer.findUnique({ where: { id }, include: { lines: true } });
    });
};

const deleteTransfer = async (id, tenantId) => {
    const trf = await findTransfer(id, tenantId);
    assertStatus(trf, 'DRAFT');
    await prisma.storeTransfer.delete({ where: { id } });
};

// ─── State Machine ────────────────────────────────────────────────────────────

const submitTransfer = async (id, tenantId, userId) => {
    const trf = await findTransfer(id, tenantId);
    assertStatus(trf, 'DRAFT');

    const updatedTrf = await prisma.$transaction(async (tx) => {
        await tx.storeTransfer.update({
            where: { id },
            data: { status: transferStatusForActiveStep(1), updatedAt: new Date() },
        });
        await createStoreTransferApprovalRequest(tx, {
            tenantId,
            transferId: id,
            createdBy: userId,
        });
        return tx.storeTransfer.findFirst({
            where: { id, tenantId },
            include: {
                lines: true,
                sourceLocation: { select: { name: true } },
                destLocation: { select: { name: true } },
            },
        });
    });

    try {
        const approvers = await prisma.tenantMember.findMany({
            where: {
                tenantId,
                role: { code: { in: ['DEPT_MANAGER'] } },
                isActive: true,
                user: { isActive: true },
            },
            select: { user: { select: { email: true } } },
        });
        const submitter = await prisma.user.findUnique({ where: { id: trf.requestedBy } });

        const pseudoApproval = {
            type: 'TRANSFER',
            createdAt: updatedTrf.createdAt,
            notes: `Transfer Number: ${updatedTrf.transferNo}`,
        };
        for (const app of approvers) {
            await emailService.sendApprovalPendingNotification(pseudoApproval, submitter, app.user.email);
        }
    } catch (err) {
        console.error('Failed to send transfer approval email:', err);
    }
    return updatedTrf;
};

const approveTransfer = async (id, tenantId, userId, userRole) => {
    const trf = await findTransfer(id, tenantId);
    assertStatus(trf, 'PENDING_DEPT', 'PENDING_FINANCE', 'PENDING_FINAL', 'SUBMITTED');
    return processStoreTransferApproval({
        transferId: id,
        tenantId,
        userId,
        userRole,
        action: 'APPROVE',
        comment: null,
    });
};

const rejectTransfer = async (id, tenantId, userId, userRole, reason) => {
    if (!reason) throw Object.assign(new Error('Rejection reason required'), { status: 400 });
    const trf = await findTransfer(id, tenantId);
    assertStatus(trf, 'PENDING_DEPT', 'PENDING_FINANCE', 'PENDING_FINAL', 'SUBMITTED');
    return processStoreTransferApproval({
        transferId: id,
        tenantId,
        userId,
        userRole,
        action: 'REJECT',
        comment: reason,
    });
};

/** Dispatch: APPROVED → IN_TRANSIT. Validates source stock before moving OUT. */
const dispatchTransfer = async (id, tenantId, userId) => {
    const trf = await findTransfer(id, tenantId);
    assertStatus(trf, 'APPROVED');

    // Pre-flight stock check
    for (const line of trf.lines) {
        const balance = await prisma.stockBalance.findUnique({
            where: { tenantId_itemId_locationId: { tenantId, itemId: line.itemId, locationId: trf.sourceLocationId } },
        });
        const onHand = balance ? Number(balance.qtyOnHand) : 0;
        if (onHand < Number(line.requestedQty))
            throw Object.assign(
                new Error(`Insufficient stock for item ${line.itemId}: available=${onHand}, requested=${Number(line.requestedQty)}`),
                { status: 422 }
            );
    }

    return prisma.storeTransfer.update({
        where: { id },
        data: { status: 'IN_TRANSIT', dispatchedAt: new Date(), updatedAt: new Date() },
    });
};

/**
 * ATOMIC: Destination confirms receipt → post TRANSFER_OUT (source) + TRANSFER_IN (dest).
 * One prisma.$transaction() — full rollback on any failure.
 */
const receiveTransfer = async (id, tenantId, userId, receivedLines = []) => {
    const trf = await findTransfer(id, tenantId);
    assertStatus(trf, 'IN_TRANSIT');

    await prisma.$transaction(async (tx) => {
        for (const line of trf.lines) {
            // Determine received qty — use supplied override or default to requestedQty
            const override = receivedLines.find(r => r.lineId === line.id);
            const receivedQty = override ? Number(override.receivedQty) : Number(line.requestedQty);
            if (receivedQty <= 0) continue; // Skip zero-qty lines

            // Source balance — must still have enough (checked again inside tx)
            const srcBalance = await tx.stockBalance.findUnique({
                where: { tenantId_itemId_locationId: { tenantId, itemId: line.itemId, locationId: trf.sourceLocationId } },
            });
            if (!srcBalance || Number(srcBalance.qtyOnHand) < receivedQty)
                throw new Error(`Insufficient source stock for item ${line.itemId} at posting time.`);

            const wac = Number(srcBalance.wacUnitCost);
            const value = receivedQty * wac;

            // ── OUT: debit source ──────────────────────────────────────────
            await tx.stockBalance.update({
                where: { tenantId_itemId_locationId: { tenantId, itemId: line.itemId, locationId: trf.sourceLocationId } },
                data: { qtyOnHand: { decrement: receivedQty }, lastUpdated: new Date() },
            });

            await tx.inventoryLedger.create({
                data: {
                    tenantId,
                    itemId: line.itemId,
                    locationId: trf.sourceLocationId,
                    movementType: 'TRANSFER_OUT',
                    qtyOut: receivedQty,
                    qtyIn: 0,
                    unitCost: wac,
                    totalValue: value,
                    referenceType: 'TRANSFER',
                    referenceId: trf.id,
                    referenceNo: trf.transferNo,
                    notes: `Transfer OUT to ${trf.destLocation.name}`,
                    createdBy: userId,
                },
            });

            // ── IN: credit destination — recalculate WAC ──────────────────
            const dstBalance = await tx.stockBalance.findUnique({
                where: { tenantId_itemId_locationId: { tenantId, itemId: line.itemId, locationId: trf.destLocationId } },
            });
            const prevQty = dstBalance ? Number(dstBalance.qtyOnHand) : 0;
            const prevWac = dstBalance ? Number(dstBalance.wacUnitCost) : 0;
            const newTotalQty = prevQty + receivedQty;
            const newWac = newTotalQty > 0
                ? ((prevQty * prevWac) + (receivedQty * wac)) / newTotalQty
                : wac;

            await tx.stockBalance.upsert({
                where: { tenantId_itemId_locationId: { tenantId, itemId: line.itemId, locationId: trf.destLocationId } },
                create: { tenantId, itemId: line.itemId, locationId: trf.destLocationId, qtyOnHand: receivedQty, wacUnitCost: wac, lastUpdated: new Date() },
                update: { qtyOnHand: newTotalQty, wacUnitCost: newWac, lastUpdated: new Date() },
            });

            await tx.inventoryLedger.create({
                data: {
                    tenantId,
                    itemId: line.itemId,
                    locationId: trf.destLocationId,
                    movementType: 'TRANSFER_IN',
                    qtyIn: receivedQty,
                    qtyOut: 0,
                    unitCost: wac,
                    totalValue: value,
                    referenceType: 'TRANSFER',
                    referenceId: trf.id,
                    referenceNo: trf.transferNo,
                    notes: `Transfer IN from ${trf.sourceLocation.name}`,
                    createdBy: userId,
                },
            });

            // Update line.receivedQty and cost
            await tx.storeTransferLine.update({
                where: { id: line.id },
                data: { receivedQty, unitCost: wac, totalValue: value },
            });
        }

        // ── Lock transfer → RECEIVED → CLOSED ──
        await tx.storeTransfer.update({
            where: { id },
            data: { status: 'RECEIVED', receivedBy: userId, receivedAt: new Date(), closedAt: new Date(), updatedAt: new Date() },
        });
    });

    // Return closed transfer  
    return prisma.storeTransfer.findUnique({
        where: { id },
        include: { lines: { include: { item: { select: { name: true } }, uom: { select: { abbreviation: true } } } }, sourceLocation: true, destLocation: true },
    });
};

// ─── Queries ─────────────────────────────────────────────────────────────────

const listTransfers = async (tenantId, { status, sourceLocationId, destLocationId, dateFrom, dateTo, page = 1, limit = 20 } = {}) => {
    const where = {
        tenantId,
        ...(status ? { status } : {}),
        ...(sourceLocationId ? { sourceLocationId } : {}),
        ...(destLocationId ? { destLocationId } : {}),
        ...(dateFrom || dateTo ? {
            transferDate: {
                ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
                ...(dateTo ? { lte: new Date(dateTo) } : {}),
            },
        } : {}),
    };
    const [total, data] = await Promise.all([
        prisma.storeTransfer.count({ where }),
        prisma.storeTransfer.findMany({
            where,
            include: {
                sourceLocation: { select: { name: true } },
                destLocation: { select: { name: true } },
                requestedByUser: { select: { firstName: true, lastName: true } },
                _count: { select: { lines: true } },
            },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);
    return { total, page, limit, data };
};

const getTransfer = async (id, tenantId) => {
    const trf = await prisma.storeTransfer.findFirst({
        where: { id, tenantId },
        include: {
            sourceLocation: { select: { name: true } },
            destLocation: { select: { name: true } },
            requestedByUser: { select: { firstName: true, lastName: true } },
            approvedByUser: { select: { firstName: true, lastName: true } },
            receivedByUser: { select: { firstName: true, lastName: true } },
            rejectedByUser: { select: { firstName: true, lastName: true } },
            lines: {
                include: {
                    item: { select: { name: true } },
                    uom: { select: { abbreviation: true } },
                },
            },
            approvalRequest: {
                include: {
                    steps: {
                        orderBy: { stepNumber: 'asc' },
                        include: { requiredRole: { select: { code: true, name: true } } },
                    },
                },
            },
        },
    });
    if (!trf) throw Object.assign(new Error('Transfer not found'), { status: 404 });
    return trf;
};

module.exports = {
    createTransfer,
    updateTransfer,
    deleteTransfer,
    submitTransfer,
    approveTransfer,
    rejectTransfer,
    dispatchTransfer,
    receiveTransfer,
    listTransfers,
    getTransfer,
};
