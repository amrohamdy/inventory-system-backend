const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { generateDocNumber, DocPrefix } = require('./docNumbering.service');
const { logAction, EntityType } = require('./auditTrail.service');
const { checkPeriodLock } = require('./periodGuard.service');
const { normalizeRole } = require('./rbac.service');
const { organizationRootId } = require('./organization.service');
const {
    notifyIncomingInternalGetPass,
    notifySourceTenantAdminsOfPermanentReceipt,
    notifyTenantRoles,
} = require('./systemNotification.service');

/**
 * ORG_MANAGER: aggregate lists across all branch hotels under the same organization root.
 * Uses active tenant (root or switched child) — same as organizationRootId() elsewhere.
 */
const resolveOrgWideGetPassListContext = async (tenantId, role) => {
    if (normalizeRole(role) !== 'ORG_MANAGER') return null;
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, parentId: true },
    });
    if (!tenant) return null;
    return { organizationRootId: organizationRootId(tenant) };
};

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
    destinationSecurityApprover: { select: { id: true, firstName: true, lastName: true, email: true } },
    destinationSecurityExitUser: { select: { id: true, firstName: true, lastName: true, email: true } },
    checkoutUser: true,
    closingUser: true,
    receivedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    destinationDeptAccepter: { select: { id: true, firstName: true, lastName: true } },
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

const getGetPassReverseAuditTrail = async (getPass) => {
    if (!getPass?.id) return null;

    const tenantScope = [getPass.tenantId, getPass.targetTenantId].filter(Boolean);
    const reverseNotes = [
        'GET_PASS_SHIP_BACK',
        'GET_PASS_CONFIRM_RETURN_EXIT',
        'GET_PASS_CONFIRM_RETURN_ARRIVAL',
        'GET_PASS_ACCEPT_RETURN_DEPARTMENT',
    ];
    const logs = await prisma.auditLog.findMany({
        where: {
            entityType: 'GET_PASS',
            entityId: String(getPass.id),
            action: 'UPDATE',
            note: { in: reverseNotes },
            tenantId: { in: tenantScope },
        },
        orderBy: { changedAt: 'desc' },
        include: {
            changedByUser: {
                select: { id: true, firstName: true, lastName: true, email: true },
            },
        },
    });

    const shipBack = logs.find((log) => log.note === 'GET_PASS_SHIP_BACK') || null;
    const confirmExit = logs.find((log) => log.note === 'GET_PASS_CONFIRM_RETURN_EXIT') || null;
    const confirmArrival = logs.find((log) => log.note === 'GET_PASS_CONFIRM_RETURN_ARRIVAL') || null;
    const acceptReturnDepartment = logs.find((log) => log.note === 'GET_PASS_ACCEPT_RETURN_DEPARTMENT') || null;

    return {
        shipBackAt: shipBack?.changedAt ?? null,
        shipBackBy: shipBack?.changedBy ?? null,
        shipBackByUser: shipBack?.changedByUser ?? null,
        confirmReturnExitAt: confirmExit?.changedAt ?? null,
        confirmReturnExitBy: confirmExit?.changedBy ?? null,
        confirmReturnExitByUser: confirmExit?.changedByUser ?? null,
        confirmReturnArrivalAt: confirmArrival?.changedAt ?? null,
        confirmReturnArrivalBy: confirmArrival?.changedBy ?? null,
        confirmReturnArrivalByUser: confirmArrival?.changedByUser ?? null,
        acceptReturnDeptAt: acceptReturnDepartment?.changedAt ?? null,
        acceptReturnDeptBy: acceptReturnDepartment?.changedBy ?? null,
        acceptReturnDeptByUser: acceptReturnDepartment?.changedByUser ?? null,
    };
};

const PENDING_APPROVAL_STATUSES = [
    'PENDING_DEPT',
    'PENDING_COST_CONTROL',
    'PENDING_FINANCE',
    'PENDING_GM',
    'PENDING_SECURITY',
];
const BLOCKING_TRANSFER_TYPES = new Set(['TEMPORARY', 'CATERING', 'OUTSIDE_CATERING']);
const OVERDUE_TRANSFER_TYPES = new Set(['TEMPORARY', 'CATERING', 'OUTSIDE_CATERING']);
const OVERDUE_STATUSES = new Set(['OUT', 'PARTIALLY_RETURNED']);
const RETURN_REQUIRED_TRANSFER_TYPES = new Set(['TEMPORARY', 'CATERING', 'OUTSIDE_CATERING']);

const STEP_ROLE = {
    PENDING_DEPT: 'DEPT_MANAGER',
    PENDING_COST_CONTROL: 'COST_CONTROL',
    PENDING_FINANCE: 'FINANCE_MANAGER',
    PENDING_GM: 'GENERAL_MANAGER',
    PENDING_SECURITY: 'SECURITY',
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
            status: 'PENDING_SECURITY',
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
    if (RETURN_REQUIRED_TRANSFER_TYPES.has(data.transferType)) {
        const effective = returnDate || expectedReturnDate;
        if (data.transferType === 'TEMPORARY') {
            if (!effective) {
                throw Object.assign(new Error('returnDate or expectedReturnDate is required for TEMPORARY transfers.'), {
                    statusCode: 400,
                });
            }
            returnDate = returnDate || effective;
            expectedReturnDate = expectedReturnDate || effective;
        } else {
            if (!expectedReturnDate) {
                throw Object.assign(
                    new Error('expectedReturnDate is required for CATERING and OUTSIDE_CATERING transfers.'),
                    { statusCode: 400 }
                );
            }
            returnDate = null;
        }
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
    if (RETURN_REQUIRED_TRANSFER_TYPES.has(transferType)) {
        const effective = returnDate || expectedReturnDate;
        if (transferType === 'TEMPORARY') {
            if (!effective) {
                throw Object.assign(new Error('returnDate or expectedReturnDate is required for TEMPORARY transfers.'), {
                    statusCode: 400,
                });
            }
            returnDate = returnDate || effective;
            expectedReturnDate = expectedReturnDate || effective;
        } else {
            if (!expectedReturnDate) {
                throw Object.assign(
                    new Error('expectedReturnDate is required for CATERING and OUTSIDE_CATERING transfers.'),
                    { statusCode: 400 }
                );
            }
            returnDate = null;
        }
    } else {
        returnDate = null;
    }
    return { returnDate, expectedReturnDate };
};

const isBlockingTransferType = (transferType) => BLOCKING_TRANSFER_TYPES.has(transferType);
const isGetPassOverdue = (getPass, now = new Date()) => {
    if (!getPass?.expectedReturnDate) return false;
    if (!OVERDUE_TRANSFER_TYPES.has(getPass.transferType)) return false;
    if (!OVERDUE_STATUSES.has(getPass.status)) return false;
    return new Date(getPass.expectedReturnDate) < now;
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

const getGetPasses = async (tenantId, params = {}, user) => {
    const { status, transferType, page = 1, limit = 50 } = params;
    const skip = (page - 1) * limit;

    const listContext = user ? await resolveOrgWideGetPassListContext(tenantId, user.role) : null;

    let where;
    if (listContext?.organizationRootId) {
        where = { tenant: { parentId: listContext.organizationRootId } };
    } else {
        where = { tenantId };
    }
    if (status) where.status = status;
    if (transferType) where.transferType = transferType;

    const include = {
        department: true,
        targetTenant: { select: { id: true, name: true, slug: true } },
        createdByUser: { select: { firstName: true, lastName: true } },
    };
    if (listContext?.organizationRootId) {
        include.tenant = { select: { id: true, name: true, slug: true, email: true } };
    }

    const [rows, total] = await Promise.all([
        prisma.getPass.findMany({
            where,
            include,
            orderBy: { createdAt: 'desc' },
            skip,
            take: Number(limit),
        }),
        prisma.getPass.count({ where }),
    ]);

    const now = new Date();
    const data = rows.map((row) => ({ ...row, isOverdue: isGetPassOverdue(row, now) }));

    return { data, total, page: Number(page), limit: Number(limit) };
};

/**
 * Target hotel — full history of internal transfers addressed to this property after dispatch (OUT+).
 * Includes finished transfers (CLOSED, RETURNED, etc.) so the list is not only “pending”.
 * APPROVED (not yet dispatched from source) is excluded until checkout.
 */
const getIncomingGetPasses = async (targetTenantId, params = {}, user) => {
    const { page = 1, limit = 50 } = params;
    const skip = (page - 1) * limit;

    const listContext = user ? await resolveOrgWideGetPassListContext(targetTenantId, user.role) : null;

    const incomingStatuses = [
        'OUT',
        'RECEIVED_AT_DESTINATION',
        'RETURNING',
        'RETURN_RECEIVED_AT_GATE',
        'PARTIALLY_RETURNED',
        'RETURNED',
        'CLOSED',
    ];

    let where;
    if (listContext?.organizationRootId) {
        where = {
            isInternalTransfer: true,
            status: { in: incomingStatuses },
            targetTenant: { parentId: listContext.organizationRootId },
        };
    } else {
        where = {
            targetTenantId,
            isInternalTransfer: true,
            status: { in: incomingStatuses },
        };
    }

    const include = {
        tenant: { select: { id: true, name: true, slug: true, email: true } },
        department: true,
        createdByUser: { select: { firstName: true, lastName: true } },
    };
    if (listContext?.organizationRootId) {
        include.targetTenant = { select: { id: true, name: true, slug: true, email: true } };
    }

    const [rows, total] = await Promise.all([
        prisma.getPass.findMany({
            where,
            include,
            orderBy: { updatedAt: 'desc' },
            skip,
            take: Number(limit),
        }),
        prisma.getPass.count({ where }),
    ]);

    const now = new Date();
    const data = rows.map(({ tenant, ...rest }) => ({
        ...rest,
        sourceTenant: tenant,
        isOverdue: isGetPassOverdue(rest, now),
    }));

    return { data, total, page: Number(page), limit: Number(limit) };
};

/**
 * Source hotel reverse-logistics queue:
 * internal temporary/catering passes currently returning back to issuer.
 */
const getReturningGetPasses = async (sourceTenantId, params = {}, user) => {
    const { page = 1, limit = 50 } = params;
    const skip = (page - 1) * limit;

    const listContext = user ? await resolveOrgWideGetPassListContext(sourceTenantId, user.role) : null;

    let where;
    if (listContext?.organizationRootId) {
        where = {
            isInternalTransfer: true,
            status: { in: ['RETURNING', 'RETURN_RECEIVED_AT_GATE'] },
            tenant: { parentId: listContext.organizationRootId },
        };
    } else {
        where = {
            tenantId: sourceTenantId,
            isInternalTransfer: true,
            status: { in: ['RETURNING', 'RETURN_RECEIVED_AT_GATE'] },
        };
    }

    const include = {
        tenant: { select: { id: true, name: true, slug: true, email: true } },
        targetTenant: { select: { id: true, name: true, slug: true, email: true } },
        department: true,
        createdByUser: { select: { firstName: true, lastName: true } },
    };

    const [rows, total] = await Promise.all([
        prisma.getPass.findMany({
            where,
            include,
            orderBy: { updatedAt: 'desc' },
            skip,
            take: Number(limit),
        }),
        prisma.getPass.count({ where }),
    ]);

    const now = new Date();
    const data = rows.map((row) => ({ ...row, isOverdue: isGetPassOverdue(row, now) }));

    return { data, total, page: Number(page), limit: Number(limit) };
};

const getDiscrepancyClaims = async (tenantId, user) => {
    const listContext = user ? await resolveOrgWideGetPassListContext(tenantId, user.role) : null;
    const where = {
        qtyDiscrepancyAtDestination: { gt: 0 },
        getPass: listContext?.organizationRootId
            ? {
                  tenant: { parentId: listContext.organizationRootId },
              }
            : {
                  OR: [{ tenantId }, { targetTenantId: tenantId }],
              },
    };

    return prisma.getPassLine.findMany({
        where,
        include: {
            item: { select: { id: true, name: true } },
            getPass: {
                select: {
                    id: true,
                    passNo: true,
                    tenant: { select: { id: true, name: true } },
                    targetTenant: { select: { id: true, name: true } },
                },
            },
        },
        orderBy: [{ getPass: { updatedAt: 'desc' } }, { item: { name: 'asc' } }],
    });
};

const checkAndNotifyOverduePasses = async ({ notifyCostControl = false } = {}) => {
    const now = new Date();
    const overduePasses = await prisma.getPass.findMany({
        where: {
            transferType: { in: Array.from(OVERDUE_TRANSFER_TYPES) },
            status: { in: Array.from(OVERDUE_STATUSES) },
            expectedReturnDate: { not: null, lt: now },
        },
        select: {
            id: true,
            passNo: true,
            tenantId: true,
            transferType: true,
            status: true,
            expectedReturnDate: true,
        },
    });

    if (!notifyCostControl || overduePasses.length === 0) {
        return { overdueCount: overduePasses.length, notifiedCount: 0 };
    }

    let notifiedCount = 0;
    await prisma.$transaction(async (tx) => {
        for (const pass of overduePasses) {
            await notifyTenantRoles(tx, pass.tenantId, ['COST_CONTROL'], {
                type: 'GET_PASS_OVERDUE',
                title: 'Overdue gate pass return',
                body: `Gate pass ${pass.passNo} is overdue (expected return ${new Date(pass.expectedReturnDate).toISOString().slice(0, 10)}).`,
                payload: { getPassId: pass.id, passNo: pass.passNo, expectedReturnDate: pass.expectedReturnDate },
            });
            notifiedCount += 1;
        }
    });

    return { overdueCount: overduePasses.length, notifiedCount };
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
            lines: true,
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

    const linesPayload = Array.isArray(body.lines) ? body.lines : [];
    const lineMap = new Map(existing.lines.map((line) => [line.id, line]));
    const receiptRows = [];
    for (const input of linesPayload) {
        const line = lineMap.get(input?.lineId);
        if (!line) {
            throw Object.assign(new Error('Invalid lineId in receipt payload.'), { statusCode: 400 });
        }
        const shippedQty = Number(line.qty);
        const receivedQty = Number(input.receivedQty ?? shippedQty);
        if (!Number.isFinite(receivedQty) || receivedQty < 0 || receivedQty > shippedQty) {
            throw Object.assign(new Error(`Invalid receivedQty for line ${line.id}.`), { statusCode: 400 });
        }
        const discrepancyQty = Math.max(0, shippedQty - receivedQty);
        receiptRows.push({
            lineId: line.id,
            itemId: line.itemId,
            locationId: line.locationId,
            shippedQty,
            receivedQty,
            discrepancyQty,
            condition: typeof input.condition === 'string' ? input.condition.trim() : '',
            discrepancyReason: typeof input.discrepancyReason === 'string' ? input.discrepancyReason.trim() : '',
        });
    }
    if (receiptRows.length === 0) {
        for (const line of existing.lines) {
            const shippedQty = Number(line.qty);
            receiptRows.push({
                lineId: line.id,
                itemId: line.itemId,
                locationId: line.locationId,
                shippedQty,
                receivedQty: shippedQty,
                discrepancyQty: 0,
                condition: '',
                discrepancyReason: '',
            });
        }
    }

    const receivedAt = new Date();

    await prisma.$transaction(async (tx) => {
        if (existing.transferType === 'PERMANENT') {
            for (const row of receiptRows) {
                const sourceStock = await tx.stockBalance.findUnique({
                    where: {
                        tenantId_itemId_locationId: {
                            tenantId: existing.tenantId,
                            itemId: row.itemId,
                            locationId: row.locationId,
                        },
                    },
                });
                const sourceWac = Number(sourceStock?.wacUnitCost || 0);

                if (row.discrepancyQty > 0) {
                    await tx.inventoryLedger.create({
                        data: {
                            tenantId: targetTenantId,
                            itemId: row.itemId,
                            locationId: row.locationId,
                            movementType: 'LOAN_WRITE_OFF',
                            qtyIn: 0,
                            qtyOut: row.discrepancyQty,
                            unitCost: sourceWac,
                            totalValue: row.discrepancyQty * sourceWac,
                            referenceType: 'GET_PASS',
                            referenceId: id,
                            referenceNo: existing.passNo,
                            notes: row.discrepancyReason || 'Incoming discrepancy at destination receipt',
                            createdBy: userId,
                        },
                    });
                }
            }
        }

        await tx.getPass.update({
            where: { id },
            data: {
                status: 'RECEIVED_AT_DESTINATION',
                receivedById: userId,
                receivedAt,
                receivedCondition,
                receivedNotes: receivedNotes || null,
                destinationSecurityApprovedBy: userId,
                destinationSecurityApprovedAt: receivedAt,
            },
        });
        for (const row of receiptRows) {
            await tx.getPassLine.update({
                where: { id: row.lineId },
                data: {
                    qtyReceivedAtDestination: row.receivedQty,
                    qtyDiscrepancyAtDestination: row.discrepancyQty,
                    receivedCondition: row.condition || null,
                    discrepancyReason: row.discrepancyReason || null,
                },
            });
        }

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
 * Destination hotel: department manager (or org manager) records final acceptance after gate receipt.
 */
const acceptDestinationDepartment = async (id, viewerTenantId, user, payload = {}) => {
    const getPass = await findReadablePass(prisma, id, viewerTenantId);
    if (!getPass) {
        throw Object.assign(new Error('Get Pass not found'), { statusCode: 404 });
    }
    if (!getPass.isInternalTransfer || getPass.targetTenantId !== viewerTenantId) {
        throw Object.assign(new Error('Only the destination property can accept into department.'), {
            statusCode: 403,
        });
    }
    if (getPass.destinationDeptAcceptedAt) {
        throw Object.assign(new Error('Already accepted into department.'), { statusCode: 400 });
    }
    if (!getPass.receivedAt || getPass.status === 'OUT' || getPass.status === 'APPROVED') {
        throw Object.assign(new Error('Gate receipt must be confirmed before department acceptance.'), {
            statusCode: 400,
        });
    }
    if (!['RECEIVED_AT_DESTINATION', 'PARTIALLY_RETURNED', 'RETURNED'].includes(getPass.status)) {
        throw Object.assign(new Error('Invalid status for department acceptance.'), { statusCode: 400 });
    }
    const targetDepartmentId =
        typeof payload.targetDepartmentId === 'string' ? payload.targetDepartmentId.trim() : '';
    const targetLocationId =
        typeof payload.targetLocationId === 'string' ? payload.targetLocationId.trim() : '';
    if (!targetDepartmentId || !targetLocationId) {
        throw Object.assign(new Error('targetDepartmentId and targetLocationId are required.'), {
            statusCode: 400,
        });
    }

    const role = normalizeRole(user.role);
    if (isAdminBypass(role) || role === 'ORG_MANAGER') {
        // Authorized manager at destination hotel level.
    } else if (role === 'DEPT_MANAGER') {
        // Destination acceptance is performed by the receiving hotel manager.
        // Do not compare with source pass department, because destination department
        // is selected during this acceptance step.
        if (user.tenantId !== getPass.targetTenantId) {
            throw Object.assign(
                new Error('You must be an authorized manager at the destination hotel to accept these items.'),
                { statusCode: 403 },
            );
        }
    } else {
        throw Object.assign(
            new Error('You must be an authorized manager at the destination hotel to accept these items.'),
            { statusCode: 403 },
        );
    }

    await prisma.$transaction(async (tx) => {
        const targetDepartment = await tx.department.findFirst({
            where: { id: targetDepartmentId, tenantId: viewerTenantId, isActive: true },
            select: { id: true },
        });
        if (!targetDepartment) {
            throw Object.assign(new Error('Invalid targetDepartmentId for destination tenant.'), {
                statusCode: 400,
            });
        }
        const targetLocation = await tx.location.findFirst({
            where: {
                id: targetLocationId,
                tenantId: viewerTenantId,
                isActive: true,
                departmentId: targetDepartmentId,
            },
            select: { id: true },
        });
        if (!targetLocation) {
            throw Object.assign(
                new Error('Invalid targetLocationId. It must belong to the selected department.'),
                { statusCode: 400 },
            );
        }

        const now = new Date();
        // Archive as CLOSED when the internal transfer lifecycle is finished at destination.
        // PERMANENT: no returns — safe to close here for reporting "completed" passes.
        // TEMPORARY: returns are processed at the issuing hotel while status stays OUT / PARTIALLY_RETURNED;
        // closing here would block processReturns, so we only record destinationDeptAccepted* until source closes.
        const closeAsArchived =
            getPass.transferType === 'PERMANENT' ||
            (isBlockingTransferType(getPass.transferType) && getPass.status === 'RETURNED');

        if (getPass.transferType === 'PERMANENT') {
            for (const line of getPass.lines ?? []) {
                const receivedQty = Number(line.qtyReceivedAtDestination ?? line.qty ?? 0);
                if (!Number.isFinite(receivedQty) || receivedQty <= 0) continue;
                const sourceStock = await tx.stockBalance.findUnique({
                    where: {
                        tenantId_itemId_locationId: {
                            tenantId: getPass.tenantId,
                            itemId: line.itemId,
                            locationId: line.locationId,
                        },
                    },
                });
                const sourceWac = Number(sourceStock?.wacUnitCost || 0);
                await tx.inventoryLedger.create({
                    data: {
                        tenantId: viewerTenantId,
                        itemId: line.itemId,
                        locationId: targetLocationId,
                        movementType: 'RECEIVE',
                        qtyIn: receivedQty,
                        qtyOut: 0,
                        unitCost: sourceWac,
                        totalValue: receivedQty * sourceWac,
                        referenceType: 'GET_PASS',
                        referenceId: id,
                        referenceNo: getPass.passNo,
                        createdBy: user.id,
                    },
                });
                await tx.stockBalance.upsert({
                    where: {
                        tenantId_itemId_locationId: {
                            tenantId: viewerTenantId,
                            itemId: line.itemId,
                            locationId: targetLocationId,
                        },
                    },
                    update: {
                        qtyOnHand: { increment: receivedQty },
                    },
                    create: {
                        tenantId: viewerTenantId,
                        itemId: line.itemId,
                        locationId: targetLocationId,
                        qtyOnHand: receivedQty,
                        qtyBlocked: 0,
                        wacUnitCost: sourceWac,
                    },
                });
            }
        }

        await tx.getPass.update({
            where: { id },
            data: {
                destinationDeptAcceptedAt: now,
                destinationDeptAcceptedBy: user.id,
                destinationDepartmentId: targetDepartmentId,
                destinationLocationId: targetLocationId,
                ...(closeAsArchived
                    ? {
                          status: 'CLOSED',
                          closedBy: user.id,
                          closedAt: now,
                      }
                    : {}),
            },
        });
    });

    await logAction({
        tenantId: viewerTenantId,
        entityType: EntityType.GET_PASS,
        entityId: id,
        action: 'ACCEPT_DESTINATION_DEPARTMENT',
        changedBy: user.id,
    });

    return getGetPassById(id, viewerTenantId);
};

/**
 * Destination hotel dispatches temporary/catering internal transfer back to source.
 * This starts reverse logistics and notifies source security.
 */
const shipBackGetPass = async (id, viewerTenantId, user) => {
    const getPass = await findReadablePass(prisma, id, viewerTenantId);
    if (!getPass) {
        throw Object.assign(new Error('Get Pass not found'), { statusCode: 404 });
    }
    if (!getPass.isInternalTransfer || getPass.targetTenantId !== viewerTenantId) {
        throw Object.assign(new Error('Only destination hotel can ship this pass back.'), { statusCode: 403 });
    }
    if (!['TEMPORARY', 'CATERING'].includes(getPass.transferType)) {
        throw Object.assign(new Error('Ship back is only available for temporary or catering transfers.'), {
            statusCode: 400,
        });
    }
    if (getPass.status !== 'RECEIVED_AT_DESTINATION') {
        throw Object.assign(new Error('Pass must be received at destination before ship back.'), { statusCode: 400 });
    }
    if (!getPass.destinationDeptAcceptedAt) {
        throw Object.assign(new Error('Destination department acceptance is required before ship back.'), {
            statusCode: 400,
        });
    }

    const role = normalizeRole(user.role);
    if (!['SECURITY', 'DEPT_MANAGER', 'ORG_MANAGER'].includes(role) && !isAdminBypass(role)) {
        throw Object.assign(new Error('Only destination security/manager can start return shipping.'), {
            statusCode: 403,
        });
    }

    await prisma.$transaction(async (tx) => {
        await tx.getPass.update({
            where: { id },
            data: {
                status: 'RETURNING',
                destinationSecurityExitAt: null,
                destinationSecurityExitBy: null,
            },
        });

        await notifyTenantRoles(tx, getPass.tenantId, ['SECURITY'], {
            type: 'GET_PASS_RETURNING',
            title: 'Incoming return from destination hotel',
            body: `Get pass ${getPass.passNo} was shipped back and is returning to source security.`,
            payload: {
                getPassId: getPass.id,
                passNo: getPass.passNo,
                sourceTenantId: getPass.tenantId,
                targetTenantId: getPass.targetTenantId,
            },
        });
    });

    await logAction({
        tenantId: viewerTenantId,
        entityType: EntityType.GET_PASS,
        entityId: id,
        action: 'UPDATE',
        changedBy: user.id,
        note: 'GET_PASS_SHIP_BACK',
    });

    return getGetPassById(id, viewerTenantId);
};

/**
 * Destination hotel security confirms return shipment physically exited the gate.
 * Status remains RETURNING; source hotel can only confirm arrival after this stamp.
 */
const confirmReturnExit = async (id, destinationTenantId, user) => {
    const getPass = await findReadablePass(prisma, id, destinationTenantId);
    if (!getPass) {
        throw Object.assign(new Error('Get Pass not found'), { statusCode: 404 });
    }
    if (!getPass.isInternalTransfer || getPass.targetTenantId !== destinationTenantId) {
        throw Object.assign(new Error('Only destination hotel can confirm return exit.'), {
            statusCode: 403,
        });
    }
    if (!['TEMPORARY', 'CATERING'].includes(getPass.transferType)) {
        throw Object.assign(new Error('Return exit confirmation is only valid for temporary/catering transfers.'), {
            statusCode: 400,
        });
    }
    if (getPass.status !== 'RETURNING') {
        throw Object.assign(new Error('Pass is not currently returning.'), { statusCode: 400 });
    }
    if (getPass.destinationSecurityExitAt) {
        throw Object.assign(new Error('Return exit already confirmed by destination security.'), { statusCode: 400 });
    }

    const role = normalizeRole(user.role);
    if (role !== 'SECURITY' && !isAdminBypass(role)) {
        throw Object.assign(new Error('Only destination security can confirm return exit.'), {
            statusCode: 403,
        });
    }

    const now = new Date();
    await prisma.getPass.update({
        where: { id },
        data: {
            destinationSecurityExitAt: now,
            destinationSecurityExitBy: user.id,
        },
    });

    await logAction({
        tenantId: destinationTenantId,
        entityType: EntityType.GET_PASS,
        entityId: id,
        action: 'UPDATE',
        changedBy: user.id,
        note: 'GET_PASS_CONFIRM_RETURN_EXIT',
    });

    return getGetPassById(id, destinationTenantId);
};

/**
 * Source hotel security confirms returned shipment arrival (gate inspection).
 * Updates pass/lines only — no stock or inventory ledger here (posting happens at department acceptance).
 */
const confirmReturnArrival = async (id, sourceTenantId, user, payload = {}) => {
    const getPass = await findIssuerPass(prisma, id, sourceTenantId);
    if (!getPass) {
        throw Object.assign(new Error('Get Pass not found'), { statusCode: 404 });
    }
    if (!getPass.isInternalTransfer) {
        throw Object.assign(new Error('Return arrival confirmation is only valid for internal transfers.'), {
            statusCode: 400,
        });
    }
    if (!['TEMPORARY', 'CATERING'].includes(getPass.transferType)) {
        throw Object.assign(new Error('Return arrival confirmation is only valid for temporary/catering transfers.'), {
            statusCode: 400,
        });
    }
    if (getPass.status !== 'RETURNING') {
        throw Object.assign(new Error('Pass is not currently returning.'), { statusCode: 400 });
    }
    if (!getPass.destinationSecurityExitAt) {
        throw Object.assign(
            new Error('Destination security exit confirmation is required before source arrival confirmation.'),
            { statusCode: 400 },
        );
    }

    const role = normalizeRole(user.role);
    if (role !== 'SECURITY' && !isAdminBypass(role)) {
        throw Object.assign(new Error('Only source security can confirm return arrival.'), {
            statusCode: 403,
        });
    }

    const linesPayload = Array.isArray(payload.lines) ? payload.lines : [];
    if (linesPayload.length === 0) {
        throw Object.assign(new Error('lines are required to confirm return arrival.'), { statusCode: 400 });
    }
    const linePayloadMap = new Map(linesPayload.map((row) => [row?.lineId, row]));
    if (linePayloadMap.size !== (getPass.lines ?? []).length) {
        throw Object.assign(new Error('Inspection must include every line item.'), { statusCode: 400 });
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
        let hasReceivedQty = false;
        for (const line of getPass.lines ?? []) {
            const totalQty = Number(line.qty || 0);
            const alreadyReturned = Number(line.qtyReturned || 0);
            const outstanding = Math.max(0, totalQty - alreadyReturned);
            const linePayload = linePayloadMap.get(line.id);
            if (!linePayload) {
                throw Object.assign(new Error(`Missing inspection row for line ${line.id}.`), { statusCode: 400 });
            }
            const conditionIn = typeof linePayload.condition === 'string' ? linePayload.condition.trim() : '';
            if (!conditionIn) {
                throw Object.assign(new Error('condition is required for each inspected line.'), { statusCode: 400 });
            }
            const receivedQty = Number(linePayload.receivedQty);
            if (!Number.isFinite(receivedQty) || receivedQty < 0) {
                throw Object.assign(new Error('receivedQty must be a valid number for each inspected line.'), {
                    statusCode: 400,
                });
            }
            if (receivedQty > outstanding) {
                throw Object.assign(new Error(`receivedQty exceeds outstanding quantity for line ${line.id}.`), {
                    statusCode: 400,
                });
            }
            if (receivedQty > 0) hasReceivedQty = true;

            await tx.getPassLine.update({
                where: { id: line.id },
                data: {
                    qtyReturned: alreadyReturned + receivedQty,
                    receivedCondition: conditionIn,
                    status: alreadyReturned + receivedQty >= totalQty - 1e-9 ? 'RETURNED' : 'PARTIALLY_RETURNED',
                },
            });
        }
        if (!hasReceivedQty) {
            throw Object.assign(new Error('At least one line must have receivedQty greater than 0.'), { statusCode: 400 });
        }

        await tx.getPass.update({
            where: { id },
            data: {
                status: 'RETURN_RECEIVED_AT_GATE',
                receivedById: user.id,
                receivedAt: now,
                closedBy: null,
                closedAt: null,
            },
        });
    });

    await logAction({
        tenantId: sourceTenantId,
        entityType: EntityType.GET_PASS,
        entityId: id,
        action: 'UPDATE',
        changedBy: user.id,
        note: 'GET_PASS_CONFIRM_RETURN_ARRIVAL',
    });

    return getGetPassById(id, sourceTenantId);
};

/**
 * Source hotel department accepts inspected return.
 * Sole posting point for reverse logistics: release blocked qty, restore on-hand, inventory ledger (one set per pass).
 */
const acceptReturnIntoDepartment = async (id, sourceTenantId, user) => {
    const getPass = await findIssuerPass(prisma, id, sourceTenantId);
    if (!getPass) {
        throw Object.assign(new Error('Get Pass not found'), { statusCode: 404 });
    }
    if (!getPass.isInternalTransfer) {
        throw Object.assign(new Error('Return department acceptance is only valid for internal transfers.'), {
            statusCode: 400,
        });
    }
    if (!['TEMPORARY', 'CATERING'].includes(getPass.transferType)) {
        throw Object.assign(new Error('Return department acceptance is only valid for temporary/catering transfers.'), {
            statusCode: 400,
        });
    }
    if (getPass.status !== 'RETURN_RECEIVED_AT_GATE') {
        throw Object.assign(new Error('Pass must be received at source gate before department acceptance.'), {
            statusCode: 400,
        });
    }
    const role = normalizeRole(user.role);
    if (role !== 'DEPT_MANAGER' && !isAdminBypass(role)) {
        throw Object.assign(new Error('Only source department manager can accept return into department.'), {
            statusCode: 403,
        });
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
        for (const line of getPass.lines ?? []) {
            const lineQty = Number(line.qty || 0);
            const qtyReceivedAtGate = Number(line.qtyReturned || 0);
            if (!Number.isFinite(lineQty) || lineQty <= 0) continue;

            const lostInTransit = Math.max(0, lineQty - qtyReceivedAtGate);
            const wac = Number(line.unitCost || 0);

            const stock = await tx.stockBalance.findUnique({
                where: {
                    tenantId_itemId_locationId: {
                        tenantId: sourceTenantId,
                        itemId: line.itemId,
                        locationId: line.locationId,
                    },
                },
            });
            const blocked = stock ? Number(stock.qtyBlocked || 0) : 0;
            const targetBlockRelease = qtyReceivedAtGate + lostInTransit;
            const releaseFromBlocked = Math.min(blocked, targetBlockRelease);

            if (releaseFromBlocked > 0) {
                await tx.stockBalance.update({
                    where: {
                        tenantId_itemId_locationId: {
                            tenantId: sourceTenantId,
                            itemId: line.itemId,
                            locationId: line.locationId,
                        },
                    },
                    data: {
                        qtyBlocked: { decrement: releaseFromBlocked },
                    },
                });
            }

            if (qtyReceivedAtGate > 0) {
                await tx.stockBalance.update({
                    where: {
                        tenantId_itemId_locationId: {
                            tenantId: sourceTenantId,
                            itemId: line.itemId,
                            locationId: line.locationId,
                        },
                    },
                    data: {
                        qtyOnHand: { increment: qtyReceivedAtGate },
                    },
                });
                await tx.inventoryLedger.create({
                    data: {
                        tenantId: sourceTenantId,
                        itemId: line.itemId,
                        locationId: line.locationId,
                        movementType: 'GET_PASS_RETURN',
                        qtyIn: qtyReceivedAtGate,
                        qtyOut: 0,
                        unitCost: wac,
                        totalValue: qtyReceivedAtGate * wac,
                        referenceType: 'GET_PASS',
                        referenceId: id,
                        referenceNo: getPass.passNo,
                        createdBy: user.id,
                        notes: 'Return posted at department acceptance (after gate inspection)',
                    },
                });
            }

            if (lostInTransit > 0) {
                await tx.inventoryLedger.create({
                    data: {
                        tenantId: sourceTenantId,
                        itemId: line.itemId,
                        locationId: line.locationId,
                        movementType: 'ADJUSTMENT',
                        qtyIn: 0,
                        qtyOut: lostInTransit,
                        unitCost: wac,
                        totalValue: lostInTransit * wac,
                        referenceType: 'GET_PASS',
                        referenceId: id,
                        referenceNo: getPass.passNo,
                        createdBy: user.id,
                        notes: 'Lost during return transfer',
                    },
                });
            }
        }

        await tx.getPass.update({
            where: { id },
            data: {
                status: 'CLOSED',
                closedBy: user.id,
                closedAt: now,
            },
        });
    });

    await logAction({
        tenantId: sourceTenantId,
        entityType: EntityType.GET_PASS,
        entityId: id,
        action: 'UPDATE',
        changedBy: user.id,
        note: 'GET_PASS_ACCEPT_RETURN_DEPARTMENT',
    });

    return getGetPassById(id, sourceTenantId);
};

/**
 * Issuer or internal target hotel — read-only API / PDF.
 */
const getGetPassById = async (id, tenantId) => {
    const getPass = await findReadablePass(prisma, id, tenantId);
    if (!getPass) throw new Error('Get Pass not found');
    const reverseAuditTrail = await getGetPassReverseAuditTrail(getPass);
    return { ...getPass, reverseAuditTrail };
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

const checkoutAndStampExitInTx = async (tx, getPass, tenantId, user, linesOut = [], exitAt = new Date()) => {
    for (const line of getPass.lines) {
        const stock = await tx.stockBalance.findUnique({
            where: { tenantId_itemId_locationId: { tenantId, itemId: line.itemId, locationId: line.locationId } },
        });

        const qtyReq = Number(line.qty);
        const availableQty = stock ? Number(stock.qtyOnHand) - Number(stock.qtyBlocked || 0) : 0;
        if (!stock || availableQty < qtyReq) {
            throw new Error(`Insufficient stock for ${line.item?.name || 'item'}. Available: ${availableQty}`);
        }

        const wac = Number(stock.wacUnitCost);
        if (isBlockingTransferType(getPass.transferType)) {
            await tx.stockBalance.update({
                where: { tenantId_itemId_locationId: { tenantId, itemId: line.itemId, locationId: line.locationId } },
                data: { qtyBlocked: { increment: qtyReq } },
            });
        } else {
            await tx.stockBalance.update({
                where: { tenantId_itemId_locationId: { tenantId, itemId: line.itemId, locationId: line.locationId } },
                data: { qtyOnHand: { decrement: qtyReq } },
            });
        }

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
                createdBy: user.id,
            },
        });

        const linePayload = linesOut?.find((l) => l.lineId === line.id);
        const conditionOut = linePayload?.conditionOut || line.conditionOut;
        await tx.getPassLine.update({
            where: { id: line.id },
            data: { status: 'OUT', unitCost: wac, conditionOut },
        });
    }

    const internalToDestination = Boolean(getPass.isInternalTransfer && getPass.targetTenantId);
    const permanentCloseAtSource = getPass.transferType === 'PERMANENT' && !internalToDestination;
    const newStatus = permanentCloseAtSource ? 'CLOSED' : 'OUT';
    await tx.getPass.update({
        where: { id: getPass.id },
        data: {
            status: newStatus,
            checkedOutBy: user.id,
            checkedOutAt: exitAt,
            securityApprovedBy: user.id,
            securityApprovedAt: exitAt,
            closedBy: permanentCloseAtSource ? user.id : null,
            closedAt: permanentCloseAtSource ? exitAt : null,
        },
    });
};

/**
 * Approval chain:
 * PENDING_DEPT → … → PENDING_GM → PENDING_SECURITY.
 * Security approval now executes exit/stock movement immediately (status OUT or CLOSED).
 */
const approveGetPass = async (id, tenantId, user) => {
    const getPass = await prisma.getPass.findFirst({ where: { id, tenantId } });
    if (!getPass) throw new Error('Get Pass not found');
    if (!PENDING_APPROVAL_STATUSES.includes(getPass.status)) {
        throw new Error('Get Pass is not pending any approval');
    }
    assertCanActOnStatus(getPass.status, user.role);

    if (getPass.status === 'PENDING_SECURITY') {
        await checkPeriodLock(tenantId, new Date());
        await prisma.$transaction(async (tx) => {
            const passWithLines = await tx.getPass.findFirst({
                where: { id, tenantId, status: 'PENDING_SECURITY' },
                include: { lines: { include: { item: true } } },
            });
            if (!passWithLines) {
                throw new Error('Get Pass is not pending security approval');
            }
            await checkoutAndStampExitInTx(tx, passWithLines, tenantId, user, [], new Date());
        });
        await logAction({
            tenantId,
            entityType: EntityType.GET_PASS,
            entityId: id,
            action: 'APPROVE_PENDING_SECURITY',
            changedBy: user.id,
        });
        return getGetPassById(id, tenantId);
    }

    const now = new Date();
    let updateData;
    switch (getPass.status) {
        case 'PENDING_DEPT':
            updateData = {
                status: 'PENDING_COST_CONTROL',
                deptApprovedBy: user.id,
                deptApprovedAt: now,
            };
            break;
        case 'PENDING_COST_CONTROL':
            updateData = {
                status: 'PENDING_FINANCE',
                costControlApprovedBy: user.id,
                costControlApprovedAt: now,
            };
            break;
        case 'PENDING_FINANCE':
            updateData = {
                status: 'PENDING_GM',
                financeApprovedBy: user.id,
                financeApprovedAt: now,
            };
            break;
        case 'PENDING_GM':
            updateData = {
                status: 'PENDING_SECURITY',
                gmApprovedBy: user.id,
                gmApprovedAt: now,
            };
            break;
        default:
            throw new Error('Get Pass is not pending any approval');
    }

    await prisma.getPass.update({ where: { id }, data: updateData });
    await logAction({
        tenantId,
        entityType: EntityType.GET_PASS,
        entityId: id,
        action: `APPROVE_${getPass.status}`,
        changedBy: user.id,
    });
    return getGetPassById(id, tenantId);
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
            securityApprovedAt: null,
            destinationSecurityApprovedBy: null,
            destinationSecurityApprovedAt: null,
            destinationSecurityExitBy: null,
            destinationSecurityExitAt: null,
        }
    });
    await logAction({ tenantId, entityType: EntityType.GET_PASS, entityId: id, action: 'REJECT', changedBy: user.id });
    return updated;
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
            if (isBlockingTransferType(getPass.transferType) && total > 0) {
                await tx.stockBalance.update({
                    where: { tenantId_itemId_locationId: { tenantId, itemId: line.itemId, locationId: line.locationId } },
                    data: { qtyBlocked: { decrement: total } },
                });
            }

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
    getReturningGetPasses,
    getDiscrepancyClaims,
    checkAndNotifyOverduePasses,
    getGetPassById,
    confirmDestinationReceipt,
    acceptDestinationDepartment,
    shipBackGetPass,
    confirmReturnExit,
    confirmReturnArrival,
    acceptReturnIntoDepartment,
    updateGetPass,
    deleteGetPass,
    submitGetPass,
    approveGetPass,
    rejectGetPass,
    processReturns,
    closeGetPass,
};
