const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { generateDocNumber, DocPrefix } = require('./docNumbering.service');
const { logAction, EntityType } = require('./auditTrail.service');
const { checkPeriodLock } = require('./periodGuard.service');
const { hasPermission } = require('../middleware/authorize');
const { normalizeRole } = require('./rbac.service');
const { organizationRootId } = require('./organization.service');
const {
    notifyIncomingInternalGetPass,
    notifySourceTenantAdminsOfPermanentReceipt,
} = require('./systemNotification.service');

/** Prisma include graph for Get Pass detail (issuer + reader). */
const getPassDetailInclude = {
    department: true,
    tenant: { select: { id: true, name: true, slug: true, email: true, phone: true, address: true } },
    targetTenant: { select: { id: true, name: true, slug: true, email: true } },
    createdByUser: true,
    deptApprover: true,
    costControlApprover: true,
    financeApprover: true,
    gmApprover: true,
    securityApprover: true,
    checkoutUser: true,
    closingUser: true,
    receivedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    lines: {
        include: {
            item: true,
            location: true,
            returns: { include: { registeredByUser: true, securityUser: true } },
        },
    },
};

const findIssuerPass = (tx, id, issuerTenantId) =>
    tx.getPass.findFirst({
        where: { id, tenantId: issuerTenantId },
        include: getPassDetailInclude,
    });

const findReadablePass = (tx, id, viewerTenantId) =>
    tx.getPass.findFirst({
        where: {
            id,
            OR: [{ tenantId: viewerTenantId }, { targetTenantId: viewerTenantId, isInternalTransfer: true }],
        },
        include: getPassDetailInclude,
    });

/**
 * Issuing hotel only — mutations (update, checkout, returns, …).
 */
const getIssuerGetPassById = async (id, issuerTenantId) => {
    const getPass = await findIssuerPass(prisma, id, issuerTenantId);
    if (!getPass) throw new Error('Get Pass not found');
    return getPass;
};

const PENDING_APPROVAL_STATUSES = [
    'PENDING_DEPT',
    'PENDING_COST_CONTROL',
    'PENDING_FINANCE',
    'PENDING_GM'
];

const STEP_ROLE = {
    PENDING_DEPT: 'DEPT_MANAGER',
    PENDING_COST_CONTROL: 'COST_CONTROL',
    PENDING_FINANCE: 'FINANCE_MANAGER',
    PENDING_GM: 'GENERAL_MANAGER'
};

const isAdminBypass = (role) => {
    const r = normalizeRole(role);
    return r === 'ADMIN' || r === 'SUPER_ADMIN';
};

/**
 * First workflow step after submit: skip stages the submitter role already represents.
 * DEPT_MANAGER → Cost Control queue (HOD step recorded as self on submit).
 * COST_CONTROL → Finance queue (CC step recorded as self on submit).
 */
const getSubmitInitialWorkflow = (role, userId) => {
    const r = normalizeRole(role);
    const now = new Date();
    if (r === 'ADMIN' || r === 'SUPER_ADMIN') {
        return {
            status: 'APPROVED',
            deptApprovedBy: userId,
            deptApprovedAt: now,
            costControlApprovedBy: userId,
            costControlApprovedAt: now,
            financeApprovedBy: userId,
            financeApprovedAt: now,
            gmApprovedBy: userId,
            gmApprovedAt: now,
        };
    }
    if (r === 'DEPT_MANAGER') {
        return {
            status: 'PENDING_COST_CONTROL',
            deptApprovedBy: userId,
            deptApprovedAt: now,
        };
    }
    if (r === 'COST_CONTROL') {
        return {
            status: 'PENDING_FINANCE',
            costControlApprovedBy: userId,
            costControlApprovedAt: now,
        };
    }
    return { status: 'PENDING_DEPT' };
};

const assertCanActOnStatus = (status, role) => {
    const required = STEP_ROLE[status];
    if (!required) return;
    if (isAdminBypass(role) || role === required) return;
    throw new Error(`Unauthorized for this approval step (requires ${required})`);
};

const resolveTemporaryDatesForCreate = (data) => {
    let returnDate = data.returnDate ? new Date(data.returnDate) : null;
    let expectedReturnDate = data.expectedReturnDate ? new Date(data.expectedReturnDate) : null;
    if (data.transferType === 'TEMPORARY') {
        const effective = returnDate || expectedReturnDate;
        if (!effective) {
            throw Object.assign(new Error('returnDate or expectedReturnDate is required for TEMPORARY transfers.'), {
                statusCode: 400,
            });
        }
        returnDate = returnDate || effective;
        expectedReturnDate = expectedReturnDate || effective;
    } else {
        returnDate = null;
    }
    return { returnDate, expectedReturnDate };
};

const resolveTemporaryDatesForUpdate = (data, existing) => {
    const transferType = data.transferType !== undefined ? data.transferType : existing.transferType;
    let returnDate =
        data.returnDate !== undefined
            ? (data.returnDate ? new Date(data.returnDate) : null)
            : existing.returnDate;
    let expectedReturnDate =
        data.expectedReturnDate !== undefined
            ? (data.expectedReturnDate ? new Date(data.expectedReturnDate) : null)
            : existing.expectedReturnDate;
    if (transferType === 'TEMPORARY') {
        const effective = returnDate || expectedReturnDate;
        if (!effective) {
            throw Object.assign(new Error('returnDate or expectedReturnDate is required for TEMPORARY transfers.'), {
                statusCode: 400,
            });
        }
        returnDate = returnDate || effective;
        expectedReturnDate = expectedReturnDate || effective;
    } else {
        returnDate = null;
    }
    return { returnDate, expectedReturnDate };
};

const assertInternalTransferAllowed = async (tx, sourceTenantId, targetTenantId) => {
    if (!targetTenantId || targetTenantId === sourceTenantId) {
        throw Object.assign(new Error('targetTenantId must be a different hotel in your organization.'), {
            statusCode: 400,
        });
    }
    const [source, target] = await Promise.all([
        tx.tenant.findUnique({
            where: { id: sourceTenantId },
            select: { id: true, parentId: true, isActive: true },
        }),
        tx.tenant.findUnique({
            where: { id: targetTenantId },
            select: { id: true, parentId: true, isActive: true },
        }),
    ]);
    if (!source?.isActive) {
        throw Object.assign(new Error('Source tenant is not active.'), { statusCode: 400 });
    }
    if (!target?.isActive) {
        throw Object.assign(new Error('Target hotel not found or inactive.'), { statusCode: 400 });
    }
    if (organizationRootId(source) !== organizationRootId(target)) {
        throw Object.assign(new Error('Target hotel must belong to the same organization.'), { statusCode: 400 });
    }
};

const createGetPass = async (tenantId, data, userId) => {
    return prisma.$transaction(async (tx) => {
        const isInternalTransfer = Boolean(data.isInternalTransfer);
        let targetTenantId = null;
        if (isInternalTransfer) {
            if (!data.targetTenantId) {
                throw Object.assign(new Error('targetTenantId is required for internal transfers.'), {
                    statusCode: 400,
                });
            }
            await assertInternalTransferAllowed(tx, tenantId, data.targetTenantId);
            targetTenantId = data.targetTenantId;
        }

        const { returnDate, expectedReturnDate } = resolveTemporaryDatesForCreate(data);

        const passNo = await generateDocNumber(tenantId, 'GP', new Date(), tx);

        const getPass = await tx.getPass.create({
            data: {
                tenantId,
                passNo,
                transferType: data.transferType,
                isInternalTransfer,
                targetTenantId,
                returnDate,
                departmentId: data.departmentId || null,
                borrowingEntity: data.borrowingEntity,
                expectedReturnDate,
                status: 'DRAFT',
                reason: data.reason,
                notes: data.notes,
                createdBy: userId,
                lines: {
                    create: data.lines.map((line) => ({
                        itemId: line.itemId,
                        locationId: line.locationId,
                        qty: Number(line.qty),
                        conditionOut: line.conditionOut,
                        status: 'PENDING',
                    })),
                },
            },
            include: { lines: true },
        });

        if (isInternalTransfer && targetTenantId) {
            const sourceTenant = await tx.tenant.findUnique({
                where: { id: tenantId },
                select: { name: true },
            });
            await notifyIncomingInternalGetPass(tx, {
                targetTenantId,
                getPassId: getPass.id,
                passNo: getPass.passNo,
                sourceTenantName: sourceTenant?.name || 'Hotel',
            });
        }

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
                targetTenant: { select: { id: true, name: true, slug: true } },
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

/**
 * Target hotel — internal transfers that are approved or already checked out from source (OUT).
 */
const getIncomingGetPasses = async (targetTenantId, params = {}) => {
    const { page = 1, limit = 50 } = params;
    const skip = (page - 1) * limit;

    const where = {
        targetTenantId,
        isInternalTransfer: true,
        status: { in: ['APPROVED', 'OUT'] },
    };

    const [rows, total] = await Promise.all([
        prisma.getPass.findMany({
            where,
            include: {
                tenant: { select: { id: true, name: true, slug: true, email: true } },
                department: true,
                createdByUser: { select: { firstName: true, lastName: true } },
            },
            orderBy: { updatedAt: 'desc' },
            skip,
            take: Number(limit),
        }),
        prisma.getPass.count({ where }),
    ]);

    const data = rows.map(({ tenant, ...rest }) => ({
        ...rest,
        sourceTenant: tenant,
    }));

    return { data, total, page: Number(page), limit: Number(limit) };
};

/**
 * Destination hotel confirms physical receipt (internal transfers only; prior status must be OUT).
 */
const confirmDestinationReceipt = async (id, targetTenantId, userId, body) => {
    const receivedCondition = typeof body.receivedCondition === 'string' ? body.receivedCondition.trim() : '';
    const receivedNotes = typeof body.notes === 'string' ? body.notes.trim() : '';
    if (!receivedCondition) {
        throw Object.assign(new Error('receivedCondition is required.'), { statusCode: 400 });
    }

    const existing = await prisma.getPass.findFirst({
        where: {
            id,
            targetTenantId,
            isInternalTransfer: true,
            status: 'OUT',
        },
        include: {
            targetTenant: { select: { id: true, name: true, slug: true } },
        },
    });

    if (!existing) {
        throw Object.assign(
            new Error(
                'Gate pass not found, not an internal transfer to your hotel, or not ready for receipt (must be OUT).'
            ),
            { statusCode: 400 }
        );
    }

    await prisma.$transaction(async (tx) => {
        await tx.getPass.update({
            where: { id },
            data: {
                status: 'RECEIVED_AT_DESTINATION',
                receivedById: userId,
                receivedAt: new Date(),
                receivedCondition,
                receivedNotes: receivedNotes || null,
            },
        });

        if (existing.transferType === 'PERMANENT') {
            await notifySourceTenantAdminsOfPermanentReceipt(tx, existing.tenantId, {
                getPassId: id,
                passNo: existing.passNo,
                targetTenantName: existing.targetTenant?.name,
            });
        }

        await logAction({
            tenantId: existing.tenantId,
            entityType: EntityType.GET_PASS,
            entityId: id,
            action: 'CONFIRM_RECEIPT_DESTINATION',
            changedBy: userId,
        });
    });

    return getGetPassById(id, targetTenantId);
};

/**
 * Issuer or internal target hotel — read-only API / PDF.
 */
const getGetPassById = async (id, tenantId) => {
    const getPass = await findReadablePass(prisma, id, tenantId);
    if (!getPass) throw new Error('Get Pass not found');
    return getPass;
};

const updateGetPass = async (id, tenantId, data, userId) => {
    const existing = await getIssuerGetPassById(id, tenantId);
    if (existing.status !== 'DRAFT') {
        throw new Error('Can only update DRAFT Get Passes');
    }

    return prisma.$transaction(async (tx) => {
        const isInternalTransfer =
            data.isInternalTransfer !== undefined ? Boolean(data.isInternalTransfer) : existing.isInternalTransfer;
        let targetTenantId = existing.targetTenantId;
        if (isInternalTransfer) {
            const tid = data.targetTenantId !== undefined ? data.targetTenantId : existing.targetTenantId;
            if (!tid) {
                throw Object.assign(new Error('targetTenantId is required for internal transfers.'), {
                    statusCode: 400,
                });
            }
            await assertInternalTransferAllowed(tx, tenantId, tid);
            targetTenantId = tid;
        } else {
            targetTenantId = null;
        }

        const { returnDate, expectedReturnDate } = resolveTemporaryDatesForUpdate(data, existing);

        // Update header
        await tx.getPass.update({
            where: { id },
            data: {
                transferType: data.transferType,
                isInternalTransfer,
                targetTenantId,
                returnDate,
                departmentId: data.departmentId || null,
                borrowingEntity: data.borrowingEntity,
                expectedReturnDate,
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
    const existing = await prisma.getPass.findFirst({ where: { id, tenantId } });
    if (!existing) throw new Error('Get Pass not found');
    if (!['DRAFT', 'REJECTED'].includes(existing.status)) {
        throw new Error('Can only delete DRAFT or REJECTED passes');
    }

    await prisma.getPass.delete({ where: { id } });
    await logAction({ tenantId, entityType: EntityType.GET_PASS, entityId: id, action: 'DELETE', changedBy: userId });
    return true;
};

const submitGetPass = async (id, tenantId, user) => {
    const userId = user.id;
    const getPass = await prisma.getPass.findFirst({ where: { id, tenantId } });
    if (!getPass) throw new Error('Get Pass not found');
    if (getPass.status !== 'DRAFT') throw new Error('Only DRAFT can be submitted');

    const workflow = getSubmitInitialWorkflow(user.role, userId);

    await prisma.getPass.update({
        where: { id },
        data: workflow,
    });
    await logAction({ tenantId, entityType: EntityType.GET_PASS, entityId: id, action: 'SUBMIT', changedBy: userId });
    return getGetPassById(id, tenantId);
};

/**
 * Strict 4-step chain (each approve advances one step):
 * PENDING_DEPT → PENDING_COST_CONTROL → PENDING_FINANCE → PENDING_GM → APPROVED.
 * DEPT_MANAGER acting on PENDING_DEPT moves to PENDING_COST_CONTROL; same pattern for CC / Finance / GM.
 */
const approveGetPass = async (id, tenantId, user) => {
    const getPass = await prisma.getPass.findFirst({ where: { id, tenantId } });
    if (!getPass) throw new Error('Get Pass not found');
    if (!PENDING_APPROVAL_STATUSES.includes(getPass.status)) {
        throw new Error('Get Pass is not pending any approval');
    }

    assertCanActOnStatus(getPass.status, user.role);

    const now = new Date();
    let updateData;

    switch (getPass.status) {
        case 'PENDING_DEPT':
            updateData = {
                status: 'PENDING_COST_CONTROL',
                deptApprovedBy: user.id,
                deptApprovedAt: now
            };
            break;
        case 'PENDING_COST_CONTROL':
            updateData = {
                status: 'PENDING_FINANCE',
                costControlApprovedBy: user.id,
                costControlApprovedAt: now
            };
            break;
        case 'PENDING_FINANCE':
            updateData = {
                status: 'PENDING_GM',
                financeApprovedBy: user.id,
                financeApprovedAt: now
            };
            break;
        case 'PENDING_GM':
            updateData = {
                status: 'APPROVED',
                gmApprovedBy: user.id,
                gmApprovedAt: now
            };
            break;
        default:
            throw new Error('Get Pass is not pending any approval');
    }

    const updated = await prisma.getPass.update({ where: { id }, data: updateData });
    await logAction({ tenantId, entityType: EntityType.GET_PASS, entityId: id, action: `APPROVE_${getPass.status}`, changedBy: user.id });
    return updated;
};

const rejectGetPass = async (id, tenantId, user, rejectionReason) => {
    const reason = typeof rejectionReason === 'string' ? rejectionReason.trim() : '';
    if (!reason) throw new Error('rejectionReason is required');

    const getPass = await prisma.getPass.findFirst({ where: { id, tenantId } });
    if (!getPass) throw new Error('Get Pass not found');
    if (!PENDING_APPROVAL_STATUSES.includes(getPass.status)) {
        throw new Error('Get Pass is not pending any approval');
    }

    assertCanActOnStatus(getPass.status, user.role);

    const updated = await prisma.getPass.update({
        where: { id },
        data: {
            status: 'REJECTED',
            rejectionReason: reason,
            deptApprovedBy: null,
            deptApprovedAt: null,
            costControlApprovedBy: null,
            costControlApprovedAt: null,
            financeApprovedBy: null,
            financeApprovedAt: null,
            gmApprovedBy: null,
            gmApprovedAt: null,
            securityApprovedBy: null,
            securityApprovedAt: null
        }
    });
    await logAction({ tenantId, entityType: EntityType.GET_PASS, entityId: id, action: 'REJECT', changedBy: user.id });
    return updated;
};

/**
 * Marks Get Pass as OUT. Deducts from StockBalance. Writes to InventoryLedger.
 */
const checkoutGetPass = async (id, tenantId, user, linesOut) => {
    if (!hasPermission(user, 'GET_PASS_APPROVE_EXIT')) throw new Error('Only Security can checkout items');

    const getPass = await getIssuerGetPassById(id, tenantId);
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

        const internalToDestination = Boolean(getPass.isInternalTransfer && getPass.targetTenantId);
        const permanentCloseAtSource = getPass.transferType === 'PERMANENT' && !internalToDestination;
        const newStatus = permanentCloseAtSource ? 'CLOSED' : 'OUT';
        const updated = await tx.getPass.update({
            where: { id },
            data: {
                status: newStatus,
                checkedOutBy: user.id,
                checkedOutAt: new Date(),
                closedBy: permanentCloseAtSource ? user.id : null,
                closedAt: permanentCloseAtSource ? new Date() : null,
            }
        });

        return updated;
    });

    await logAction({ tenantId, entityType: EntityType.GET_PASS, entityId: id, action: 'CHECKOUT', changedBy: user.id });
    return result;
};

/**
 * Parse return line payload: supports qtyGood + lostQty | damagedQty, or legacy qtyReturned + isLost/isDamaged.
 */
const parseReturnQuantities = (input, remainingQty, itemName) => {
    const n = (v) => Math.max(0, Number(v ?? 0));
    const legacyTotal = n(input.qtyReturned);
    const hasSplit =
        input.qtyGood !== undefined ||
        input.lostQty !== undefined ||
        input.damagedQty !== undefined;

    let qtyGood = 0;
    let qtyLost = 0;
    let qtyDamaged = 0;

    if (hasSplit) {
        qtyGood = n(input.qtyGood);
        qtyLost = n(input.lostQty);
        qtyDamaged = n(input.damagedQty);
    } else {
        if (legacyTotal <= 0) return null;
        const flagLost = Boolean(input.isLost);
        const flagDamaged = Boolean(input.isDamaged) && !flagLost;
        if (flagLost) qtyLost = legacyTotal;
        else if (flagDamaged) qtyDamaged = legacyTotal;
        else qtyGood = legacyTotal;
    }

    if (qtyLost > 0 && qtyDamaged > 0) {
        throw new Error(`Cannot report both lost and damaged quantities for ${itemName}`);
    }
    const total = qtyGood + qtyLost + qtyDamaged;
    if (total <= 0) return null;
    if (total > remainingQty + 1e-9) {
        throw new Error(`Cannot return more than remaining qty for ${itemName}`);
    }
    return { qtyGood, qtyLost, qtyDamaged, total };
};

/**
 * Process incoming returned items for Temporary / Catering passes
 */
const processReturns = async (id, tenantId, userId, linesPayload, notes) => {
    const getPass = await getIssuerGetPassById(id, tenantId);
    if (!['OUT', 'PARTIALLY_RETURNED'].includes(getPass.status)) throw new Error('Get Pass is not currently checked out');
    if (getPass.transferType === 'PERMANENT') throw new Error('Cannot return items on a PERMANENT pass');

    await checkPeriodLock(tenantId, new Date());

    const result = await prisma.$transaction(async (tx) => {
        for (const input of linesPayload) {
            const line = await tx.getPassLine.findFirst({
                where: { id: input.lineId, getPassId: id },
                include: { item: true },
            });
            if (!line) continue;

            const itemName = line.item?.name || 'item';
            const remainingQty = Number(line.qty) - Number(line.qtyReturned);
            const parsed = parseReturnQuantities(input, remainingQty, itemName);
            if (!parsed) continue;

            const { qtyGood, qtyLost, qtyDamaged, total } = parsed;
            const isLost = qtyLost > 0;
            const isDamaged = qtyDamaged > 0;

            const returnRecord = await tx.getPassReturn.create({
                data: {
                    getPassLineId: line.id,
                    qtyReturned: total,
                    qtyGood,
                    qtyLost,
                    qtyDamaged,
                    isLost,
                    isDamaged,
                    conditionIn: input.conditionIn,
                    notes: input.notes,
                    registeredBy: userId,
                    securityVerifiedBy: input.securityId || null,
                },
            });

            const wac = Number(line.unitCost);

            const postGoodToStock = async (qty) => {
                if (qty <= 0) return;
                await tx.inventoryLedger.create({
                    data: {
                        tenantId,
                        itemId: line.itemId,
                        locationId: line.locationId,
                        movementType: 'GET_PASS_RETURN',
                        qtyIn: qty,
                        qtyOut: 0,
                        unitCost: wac,
                        totalValue: qty * wac,
                        referenceType: 'GET_PASS_RETURN',
                        referenceId: returnRecord.id,
                        referenceNo: getPass.passNo,
                        createdBy: userId,
                    },
                });
                const currentStock = await tx.stockBalance.findUnique({
                    where: { tenantId_itemId_locationId: { tenantId, itemId: line.itemId, locationId: line.locationId } },
                });
                const curQty = currentStock ? Number(currentStock.qtyOnHand) : 0;
                const curWac = currentStock ? Number(currentStock.wacUnitCost) : 0;
                const totalValBefore = curQty * curWac;
                const newVal = totalValBefore + qty * wac;
                const newWac = curQty + qty > 0 ? newVal / (curQty + qty) : 0;
                await tx.stockBalance.upsert({
                    where: { tenantId_itemId_locationId: { tenantId, itemId: line.itemId, locationId: line.locationId } },
                    update: { qtyOnHand: { increment: qty }, wacUnitCost: newWac },
                    create: { tenantId, itemId: line.itemId, locationId: line.locationId, qtyOnHand: qty, wacUnitCost: wac },
                });
            };

            await postGoodToStock(qtyGood);

            if (qtyLost > 0) {
                await tx.inventoryLedger.create({
                    data: {
                        tenantId,
                        itemId: line.itemId,
                        locationId: line.locationId,
                        movementType: 'LOAN_WRITE_OFF',
                        qtyIn: 0,
                        qtyOut: qtyLost,
                        unitCost: wac,
                        totalValue: qtyLost * wac,
                        referenceType: 'GET_PASS_RETURN',
                        referenceId: returnRecord.id,
                        referenceNo: getPass.passNo,
                        createdBy: userId,
                    },
                });
            }

            if (qtyDamaged > 0) {
                const documentNo = await generateDocNumber(tenantId, DocPrefix.BREAKAGE, new Date());
                const brkReason = `Damaged return — Get Pass ${getPass.passNo}`;
                const brkDoc = await tx.movementDocument.create({
                    data: {
                        tenantId,
                        documentNo,
                        movementType: 'BREAKAGE',
                        status: 'POSTED',
                        postedAt: new Date(),
                        sourceLocationId: line.locationId,
                        reason: brkReason,
                        notes: `Auto from get pass return ${returnRecord.id}`,
                        documentDate: new Date(),
                        createdBy: userId,
                        lines: {
                            create: [
                                {
                                    itemId: line.itemId,
                                    locationId: line.locationId,
                                    qtyRequested: qtyDamaged,
                                    qtyInBaseUnit: qtyDamaged,
                                    unitCost: wac,
                                    totalValue: qtyDamaged * wac,
                                    notes: input.notes?.trim() || null,
                                },
                            ],
                        },
                    },
                });

                await tx.inventoryLedger.create({
                    data: {
                        tenantId,
                        itemId: line.itemId,
                        locationId: line.locationId,
                        movementType: 'GET_PASS_RETURN',
                        qtyIn: qtyDamaged,
                        qtyOut: 0,
                        unitCost: wac,
                        totalValue: qtyDamaged * wac,
                        referenceType: 'GET_PASS_RETURN',
                        referenceId: returnRecord.id,
                        referenceNo: getPass.passNo,
                        createdBy: userId,
                    },
                });

                await tx.inventoryLedger.create({
                    data: {
                        tenantId,
                        itemId: line.itemId,
                        locationId: line.locationId,
                        movementType: 'BREAKAGE',
                        qtyIn: 0,
                        qtyOut: qtyDamaged,
                        unitCost: wac,
                        totalValue: qtyDamaged * wac,
                        referenceType: 'BREAKAGE',
                        referenceId: brkDoc.id,
                        referenceNo: brkDoc.documentNo,
                        notes: brkReason,
                        createdBy: userId,
                    },
                });
            }

            const newReturned = Number(line.qtyReturned) + total;
            const lineQty = Number(line.qty);
            let lineStatus = 'PARTIALLY_RETURNED';
            if (newReturned >= lineQty - 1e-9) {
                const agg = await tx.getPassReturn.aggregate({
                    where: { getPassLineId: line.id },
                    _sum: { qtyGood: true, qtyLost: true, qtyDamaged: true },
                });
                const sumG = Number(agg._sum.qtyGood || 0);
                const sumL = Number(agg._sum.qtyLost || 0);
                const sumD = Number(agg._sum.qtyDamaged || 0);
                const allLost = sumL >= lineQty - 1e-9 && sumG < 1e-9 && sumD < 1e-9;
                lineStatus = allLost ? 'LOST' : 'RETURNED';
            }

            await tx.getPassLine.update({
                where: { id: line.id },
                data: { qtyReturned: newReturned, status: lineStatus },
            });
        }

        const allLines = await tx.getPassLine.findMany({ where: { getPassId: id } });
        const allReturned = allLines.every((l) => Number(l.qtyReturned) >= Number(l.qty));
        const someReturned = allLines.some((l) => Number(l.qtyReturned) > 0);

        let newStatus = getPass.status;
        if (allReturned) newStatus = 'RETURNED';
        else if (someReturned) newStatus = 'PARTIALLY_RETURNED';

        if (notes && notes.trim() !== '') {
            await tx.getPass.update({
                where: { id },
                data: { notes: `${getPass.notes || ''}\nReturn Note: ${notes}` },
            });
        }

        if (newStatus !== getPass.status) {
            await tx.getPass.update({
                where: { id },
                data: { status: newStatus },
            });
        }
    });

    await logAction({ tenantId, entityType: EntityType.GET_PASS, entityId: id, action: 'PROCESS_RETURN', changedBy: userId });
    return getGetPassById(id, tenantId);
};

const closeGetPass = async (id, tenantId, userId) => {
    const getPass = await prisma.getPass.findFirst({ where: { id, tenantId } });
    if (!getPass) throw new Error('Get Pass not found');
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
    getIncomingGetPasses,
    getGetPassById,
    confirmDestinationReceipt,
    updateGetPass,
    deleteGetPass,
    submitGetPass,
    approveGetPass,
    rejectGetPass,
    checkoutGetPass,
    processReturns,
    closeGetPass,
};
