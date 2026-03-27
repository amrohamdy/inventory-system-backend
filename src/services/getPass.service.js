const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { generateDocNumber } = require('./docNumbering.service');
const { logAction, EntityType } = require('./auditTrail.service');
const { checkPeriodLock } = require('./periodGuard.service');
const { hasPermission } = require('../middleware/authorize');

const createGetPass = async (tenantId, data, userId) => {
    return prisma.$transaction(async (tx) => {
        const passNo = await generateDocNumber(tenantId, 'GP', new Date(), tx);

        const getPass = await tx.getPass.create({
            data: {
                tenantId,
                passNo,
                transferType: data.transferType,
                departmentId: data.departmentId || null,
                borrowingEntity: data.borrowingEntity,
                expectedReturnDate: data.expectedReturnDate ? new Date(data.expectedReturnDate) : null,
                status: 'DRAFT',
                reason: data.reason,
                notes: data.notes,
                createdBy: userId,
                lines: {
                    create: data.lines.map(line => ({
                        itemId: line.itemId,
                        locationId: line.locationId,
                        qty: Number(line.qty),
                        conditionOut: line.conditionOut,
                        status: 'PENDING'
                    }))
                }
            },
            include: { lines: true }
        });

        await logAction({ tenantId, entityType: EntityType.GET_PASS, entityId: getPass.id, action: 'CREATE', changedBy: userId });
        return getPass;
    });
};

const getGetPasses = async (tenantId, params = {}) => {
    const { status, transferType, page = 1, limit = 50 } = params;
    const skip = (page - 1) * limit;

    const where = { tenantId };
    if (status) where.status = status;
    if (transferType) where.transferType = transferType;

    const [data, total] = await Promise.all([
        prisma.getPass.findMany({
            where,
            include: {
                department: true,
                createdByUser: { select: { firstName: true, lastName: true } }
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: Number(limit)
        }),
        prisma.getPass.count({ where })
    ]);

    return { data, total, page: Number(page), limit: Number(limit) };
};

const getGetPassById = async (id, tenantId) => {
    const getPass = await prisma.getPass.findUnique({
        where: { id, tenantId },
        include: {
            department: true,
            createdByUser: true,
            deptApprover: true,
            financeApprover: true,
            securityApprover: true,
            checkoutUser: true,
            closingUser: true,
            lines: {
                include: {
                    item: true,
                    location: true,
                    returns: { include: { registeredByUser: true, securityUser: true } }
                }
            }
        }
    });
    if (!getPass) throw new Error('Get Pass not found');
    return getPass;
};

const updateGetPass = async (id, tenantId, data, userId) => {
    const existing = await getGetPassById(id, tenantId);
    if (existing.status !== 'DRAFT') {
        throw new Error('Can only update DRAFT Get Passes');
    }

    return prisma.$transaction(async (tx) => {
        // Update header
        const updated = await tx.getPass.update({
            where: { id },
            data: {
                transferType: data.transferType,
                departmentId: data.departmentId || null,
                borrowingEntity: data.borrowingEntity,
                expectedReturnDate: data.expectedReturnDate ? new Date(data.expectedReturnDate) : null,
                reason: data.reason,
                notes: data.notes
            }
        });

        // Hard replace lines for simplicity if provided
        if (data.lines) {
            await tx.getPassLine.deleteMany({ where: { getPassId: id } });
            await tx.getPassLine.createMany({
                data: data.lines.map(line => ({
                    getPassId: id,
                    itemId: line.itemId,
                    locationId: line.locationId,
                    qty: Number(line.qty),
                    conditionOut: line.conditionOut,
                    status: 'PENDING'
                }))
            });
        }

        await logAction({ tenantId, entityType: EntityType.GET_PASS, entityId: id, action: 'UPDATE', changedBy: userId });
        return getGetPassById(id, tenantId);
    });
};

const deleteGetPass = async (id, tenantId, userId) => {
    const existing = await prisma.getPass.findUnique({ where: { id, tenantId } });
    if (!['DRAFT', 'REJECTED'].includes(existing.status)) {
        throw new Error('Can only delete DRAFT or REJECTED passes');
    }

    await prisma.getPass.delete({ where: { id } });
    await logAction({ tenantId, entityType: EntityType.GET_PASS, entityId: id, action: 'DELETE', changedBy: userId });
    return true;
};

const submitGetPass = async (id, tenantId, userId) => {
    const getPass = await prisma.getPass.findUnique({ where: { id, tenantId } });
    if (getPass.status !== 'DRAFT') throw new Error('Only DRAFT can be submitted');

    const updated = await prisma.getPass.update({
        where: { id },
        data: { status: 'PENDING_DEPT' }
    });
    await logAction({ tenantId, entityType: EntityType.GET_PASS, entityId: id, action: 'SUBMIT', changedBy: userId });
    return updated;
};

/**
 * Handles the state machine for approvals:
 * DEPT -> FINANCE -> SECURITY -> APPROVED
 */
const approveGetPass = async (id, tenantId, user, action, notes) => {
    const getPass = await prisma.getPass.findUnique({ where: { id, tenantId } });
    if (!['PENDING_DEPT', 'PENDING_FINANCE', 'PENDING_SECURITY'].includes(getPass.status)) {
        throw new Error('Get Pass is not pending any approval');
    }

    if (action === 'REJECT') {
        const updated = await prisma.getPass.update({
            where: { id },
            data: { status: 'REJECTED', notes: notes ? `${getPass.notes || ''}\nRejection Reason: ${notes}` : getPass.notes }
        });
        await logAction({ tenantId, entityType: EntityType.GET_PASS, entityId: id, action: 'REJECT', changedBy: user.id });
        return updated;
    }

    // APPROVE
    let nextStatus = getPass.status;
    const updateData = {};

    if (getPass.status === 'PENDING_DEPT') {
        if (!(user.role === 'SUPER_ADMIN' || hasPermission(user.role, 'ISSUE_APPROVE'))) {
            throw new Error('Unauthorized for Dept Approval');
        }
        nextStatus = 'PENDING_FINANCE';
        updateData.deptApprovedBy = user.id;
        updateData.deptApprovedAt = new Date();
    } else if (getPass.status === 'PENDING_FINANCE') {
        if (!(user.role === 'SUPER_ADMIN' || hasPermission(user.role, 'ISSUE_APPROVE'))) {
            throw new Error('Unauthorized for Finance Approval');
        }
        nextStatus = 'PENDING_SECURITY';
        updateData.financeApprovedBy = user.id;
        updateData.financeApprovedAt = new Date();
    } else if (getPass.status === 'PENDING_SECURITY') {
        if (!(user.role === 'SUPER_ADMIN' || hasPermission(user.role, 'GET_PASS_APPROVE'))) {
            throw new Error('Unauthorized for Security Approval');
        }
        nextStatus = 'APPROVED';
        updateData.securityApprovedBy = user.id;
        updateData.securityApprovedAt = new Date();
    }

    updateData.status = nextStatus;

    const updated = await prisma.getPass.update({ where: { id }, data: updateData });
    await logAction({ tenantId, entityType: EntityType.GET_PASS, entityId: id, action: `APPROVE_${getPass.status}`, changedBy: user.id });
    return updated;
};

/**
 * Marks Get Pass as OUT. Deducts from StockBalance. Writes to InventoryLedger.
 */
const checkoutGetPass = async (id, tenantId, user, linesOut) => {
    if (!hasPermission(user.role, 'GET_PASS_APPROVE_EXIT')) throw new Error('Only Security can checkout items');

    const getPass = await getGetPassById(id, tenantId);
    if (getPass.status !== 'APPROVED') throw new Error('Get Pass must be APPROVED before checkout');

    await checkPeriodLock(tenantId, new Date());

    const result = await prisma.$transaction(async (tx) => {
        for (const line of getPass.lines) {
            // Find current stock to get WAC and check availability
            const stock = await tx.stockBalance.findUnique({
                where: { tenantId_itemId_locationId: { tenantId, itemId: line.itemId, locationId: line.locationId } }
            });

            const qtyReq = Number(line.qty);
            if (!stock || Number(stock.qtyOnHand) < qtyReq) {
                throw new Error(`Insufficient stock for ${line.item.name}. Available: ${stock ? stock.qtyOnHand : 0}`);
            }

            const wac = Number(stock.wacUnitCost);

            // Deduct from stock
            await tx.stockBalance.update({
                where: { tenantId_itemId_locationId: { tenantId, itemId: line.itemId, locationId: line.locationId } },
                data: { qtyOnHand: { decrement: qtyReq } }
            });

            // Post Ledger
            const movementType = getPass.transferType === 'PERMANENT' ? 'ISSUE' : 'GET_PASS_OUT';
            await tx.inventoryLedger.create({
                data: {
                    tenantId,
                    itemId: line.itemId,
                    locationId: line.locationId,
                    movementType,
                    qtyIn: 0,
                    qtyOut: qtyReq,
                    unitCost: wac,
                    totalValue: qtyReq * wac,
                    referenceType: 'GET_PASS',
                    referenceId: getPass.id,
                    referenceNo: getPass.passNo,
                    createdBy: user.id
                }
            });

            // Update line
            const linePayload = linesOut?.find(l => l.lineId === line.id);
            const conditionOut = linePayload?.conditionOut || line.conditionOut;
            const lineStatus = getPass.transferType === 'PERMANENT' ? 'OUT' : 'OUT'; 
            // Permanent never returns, so we could theoretically set it to CLOSED, but keeping it OUT for consistency.

            await tx.getPassLine.update({
                where: { id: line.id },
                data: { status: lineStatus, unitCost: wac, conditionOut }
            });
        }

        const newStatus = getPass.transferType === 'PERMANENT' ? 'CLOSED' : 'OUT';
        const updated = await tx.getPass.update({
            where: { id },
            data: {
                status: newStatus,
                checkedOutBy: user.id,
                checkedOutAt: new Date(),
                closedBy: getPass.transferType === 'PERMANENT' ? user.id : null,
                closedAt: getPass.transferType === 'PERMANENT' ? new Date() : null,
            }
        });

        return updated;
    });

    await logAction({ tenantId, entityType: EntityType.GET_PASS, entityId: id, action: 'CHECKOUT', changedBy: user.id });
    return result;
};

/**
 * Process incoming returned items for Temporary / Catering passes
 */
const processReturns = async (id, tenantId, userId, linesPayload, notes) => {
    const getPass = await getGetPassById(id, tenantId);
    if (!['OUT', 'PARTIALLY_RETURNED'].includes(getPass.status)) throw new Error('Get Pass is not currently checked out');
    if (getPass.transferType === 'PERMANENT') throw new Error('Cannot return items on a PERMANENT pass');

    await checkPeriodLock(tenantId, new Date());

    const result = await prisma.$transaction(async (tx) => {
        for (const input of linesPayload) {
            const line = getPass.lines.find(l => l.id === input.lineId);
            if (!line) continue;
            
            const returnQty = Number(input.qtyReturned);
            if (returnQty <= 0) continue;

            const remainingQty = Number(line.qty) - Number(line.qtyReturned);
            if (returnQty > remainingQty) throw new Error(`Cannot return more than remaining qty for ${line.item.name}`);

            // 1. Create Return Log
            const returnRecord = await tx.getPassReturn.create({
                data: {
                    getPassLineId: line.id,
                    qtyReturned: returnQty,
                    conditionIn: input.conditionIn,
                    notes: input.notes,
                    registeredBy: userId,
                    securityVerifiedBy: input.securityId || null, 
                }
            });

            // 2. Ledger & Stock Update
            const wac = Number(line.unitCost); // The WAC it left with

            if (input.isLost) {
                // LOST -> Written off as expense. Movement = LOAN_WRITE_OFF.
                await tx.inventoryLedger.create({
                    data: {
                        tenantId,
                        itemId: line.itemId,
                        locationId: line.locationId,
                        movementType: 'LOAN_WRITE_OFF',
                        qtyIn: 0,
                        qtyOut: returnQty, // Technically it's a writeoff value
                        unitCost: wac,
                        totalValue: returnQty * wac,
                        referenceType: 'GET_PASS_RETURN',
                        referenceId: returnRecord.id,
                        referenceNo: getPass.passNo,
                        createdBy: userId
                    }
                });
                // No StockBalance update because it was already deducted on OUT. It never came back.
            } else if (input.isDamaged) {
                // DAMAGED -> Bring it back into stock so we can immediately break it, OR just break it.
                // Best practice is to bring it back then break it so ledger shows receipt then breakage.
                await tx.inventoryLedger.create({
                    data: {
                        tenantId, itemId: line.itemId, locationId: line.locationId,
                        movementType: 'GET_PASS_RETURN',
                        qtyIn: returnQty, qtyOut: 0, unitCost: wac, totalValue: returnQty * wac,
                        referenceType: 'GET_PASS_RETURN', referenceId: returnRecord.id, referenceNo: getPass.passNo, createdBy: userId
                    }
                });
                
                // Immediately break it
                await tx.inventoryLedger.create({
                    data: {
                        tenantId, itemId: line.itemId, locationId: line.locationId,
                        movementType: 'BREAKAGE',
                        qtyIn: 0, qtyOut: returnQty, unitCost: wac, totalValue: returnQty * wac,
                        referenceType: 'GET_PASS_RETURN', referenceId: returnRecord.id, referenceNo: getPass.passNo, createdBy: userId
                    }
                });
                // Net StockBalance = +0 (brings in, immediately removes)
            } else {
                // GOOD -> Normal receipt
                await tx.inventoryLedger.create({
                    data: {
                        tenantId, itemId: line.itemId, locationId: line.locationId,
                        movementType: 'GET_PASS_RETURN',
                        qtyIn: returnQty, qtyOut: 0, unitCost: wac, totalValue: returnQty * wac,
                        referenceType: 'GET_PASS_RETURN', referenceId: returnRecord.id, referenceNo: getPass.passNo, createdBy: userId
                    }
                });

                // Calculate new WAC for StockBalance
                const currentStock = await tx.stockBalance.findUnique({
                    where: { tenantId_itemId_locationId: { tenantId, itemId: line.itemId, locationId: line.locationId } }
                });
                const curQty = currentStock ? Number(currentStock.qtyOnHand) : 0;
                const curWac = currentStock ? Number(currentStock.wacUnitCost) : 0;
                const totalValBefore = curQty * curWac;
                const newVal = totalValBefore + (returnQty * wac);
                const newWac = (curQty + returnQty) > 0 ? newVal / (curQty + returnQty) : 0;

                await tx.stockBalance.upsert({
                    where: { tenantId_itemId_locationId: { tenantId, itemId: line.itemId, locationId: line.locationId } },
                    update: { qtyOnHand: { increment: returnQty }, wacUnitCost: newWac },
                    create: { tenantId, itemId: line.itemId, locationId: line.locationId, qtyOnHand: returnQty, wacUnitCost: wac }
                });
            }

            // 3. Update Line
            const newReturned = Number(line.qtyReturned) + returnQty;
            const lineStatus = newReturned >= Number(line.qty) 
                ? (input.isLost ? 'LOST' : 'RETURNED') 
                : 'PARTIALLY_RETURNED';
                
            await tx.getPassLine.update({
                where: { id: line.id },
                data: { qtyReturned: newReturned, status: lineStatus }
            });
        }

        // 4. Re-evaluate Header Status using tx scope
        const allLines = await tx.getPassLine.findMany({ where: { getPassId: id } });
        const allReturned = allLines.every(l => Number(l.qtyReturned) >= Number(l.qty));
        const someReturned = allLines.some(l => Number(l.qtyReturned) > 0);

        let newStatus = getPass.status;
        if (allReturned) newStatus = 'RETURNED';
        else if (someReturned) newStatus = 'PARTIALLY_RETURNED';

        if (notes && notes.trim() !== '') {
            await tx.getPass.update({
                where: { id },
                data: { notes: `${getPass.notes || ''}\nReturn Note: ${notes}` }
            });
        }

        if (newStatus !== getPass.status) {
            await tx.getPass.update({
                where: { id },
                data: { status: newStatus }
            });
        }
    });

    await logAction({ tenantId, entityType: EntityType.GET_PASS, entityId: id, action: 'PROCESS_RETURN', changedBy: userId });
    return getGetPassById(id, tenantId);
};

const closeGetPass = async (id, tenantId, userId) => {
    const getPass = await prisma.getPass.findUnique({ where: { id, tenantId } });
    if (!['OUT', 'PARTIALLY_RETURNED', 'RETURNED'].includes(getPass.status)) {
        throw new Error('Can only close active Get Passes.');
    }

    const updated = await prisma.getPass.update({
        where: { id },
        data: { status: 'CLOSED', closedBy: userId, closedAt: new Date() }
    });

    await logAction({ tenantId, entityType: EntityType.GET_PASS, entityId: id, action: 'CLOSE', changedBy: userId });
    return updated;
};

module.exports = {
    createGetPass,
    getGetPasses,
    getGetPassById,
    updateGetPass,
    deleteGetPass,
    submitGetPass,
    approveGetPass,
    checkoutGetPass,
    processReturns,
    closeGetPass
};
