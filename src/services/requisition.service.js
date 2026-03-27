'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate REQ-YYYYMM-NNNN */
const generateReqNo = async (tenantId) => {
    const prefix = `REQ-${new Date().toISOString().slice(0, 7).replace('-', '')}`;
    const last = await prisma.storeRequisition.findFirst({
        where: { tenantId, requisitionNo: { startsWith: prefix } },
        orderBy: { requisitionNo: 'desc' },
        select: { requisitionNo: true },
    });
    const seq = last ? parseInt(last.requisitionNo.split('-').pop()) + 1 : 1;
    return `${prefix}-${String(seq).padStart(4, '0')}`;
};

/** Generate ISS-YYYYMM-NNNN */
const generateIssueNo = async (tenantId) => {
    const prefix = `ISS-${new Date().toISOString().slice(0, 7).replace('-', '')}`;
    const last = await prisma.storeIssue.findFirst({
        where: { tenantId, issueNo: { startsWith: prefix } },
        orderBy: { issueNo: 'desc' },
        select: { issueNo: true },
    });
    const seq = last ? parseInt(last.issueNo.split('-').pop()) + 1 : 1;
    return `${prefix}-${String(seq).padStart(4, '0')}`;
};

const assertReqStatus = async (id, tenantId, ...allowed) => {
    const req = await prisma.storeRequisition.findFirst({ where: { id, tenantId } });
    if (!req) throw Object.assign(new Error('Requisition not found'), { status: 404 });
    if (!allowed.includes(req.status))
        throw Object.assign(
            new Error(`Requisition must be in ${allowed.join(' or ')} status, currently ${req.status}`),
            { status: 422 }
        );
    return req;
};

// ─── Requisition CRUD ─────────────────────────────────────────────────────────

const createRequisition = async ({ tenantId, userId, departmentName, locationId, requiredBy, remarks, lines = [] }) => {
    if (!departmentName) throw Object.assign(new Error('departmentName is required'), { status: 400 });
    if (!locationId) throw Object.assign(new Error('locationId is required'), { status: 400 });
    if (lines.length === 0) throw Object.assign(new Error('At least one line is required'), { status: 400 });

    const requisitionNo = await generateReqNo(tenantId);

    return prisma.storeRequisition.create({
        data: {
            tenantId,
            requisitionNo,
            departmentName,
            locationId,
            requestedBy: userId,
            requestDate: new Date(),
            requiredBy: requiredBy ? new Date(requiredBy) : null,
            remarks,
            lines: {
                create: lines.map(l => ({
                    itemId: l.itemId,
                    uomId: l.uomId,
                    requestedQty: l.requestedQty,
                    notes: l.notes,
                })),
            },
        },
        include: { lines: { include: { item: { select: { name: true } }, uom: { select: { abbreviation: true } } } } },
    });
};

const updateRequisition = async (id, tenantId, { departmentName, locationId, requiredBy, remarks, lines }) => {
    await assertReqStatus(id, tenantId, 'DRAFT');

    return prisma.$transaction(async (tx) => {
        await tx.storeRequisition.update({
            where: { id },
            data: {
                departmentName,
                locationId,
                requiredBy: requiredBy ? new Date(requiredBy) : undefined,
                remarks,
                updatedAt: new Date(),
            },
        });

        if (lines) {
            // Replace lines completely (delete + recreate)
            await tx.storeRequisitionLine.deleteMany({ where: { requisitionId: id } });
            if (lines.length === 0)
                throw Object.assign(new Error('At least one line is required'), { status: 400 });
            await tx.storeRequisitionLine.createMany({
                data: lines.map(l => ({
                    requisitionId: id,
                    itemId: l.itemId,
                    uomId: l.uomId,
                    requestedQty: l.requestedQty,
                    notes: l.notes,
                })),
            });
        }

        return tx.storeRequisition.findUnique({
            where: { id },
            include: { lines: true },
        });
    });
};

const deleteRequisition = async (id, tenantId) => {
    const req = await prisma.storeRequisition.findFirst({ where: { id, tenantId } });
    if (!req) throw Object.assign(new Error('Requisition not found'), { status: 404 });
    if (req.status !== 'DRAFT')
        throw Object.assign(new Error(`Only DRAFT requisitions can be deleted (current: ${req.status})`), { status: 423 });
    await prisma.storeRequisition.delete({ where: { id } });
};

// ─── State Machine ────────────────────────────────────────────────────────────

const submitRequisition = async (id, tenantId) => {
    await assertReqStatus(id, tenantId, 'DRAFT');
    return prisma.storeRequisition.update({
        where: { id },
        data: { status: 'SUBMITTED', updatedAt: new Date() },
    });
};

const approveRequisition = async (id, tenantId, userId, comment) => {
    await assertReqStatus(id, tenantId, 'SUBMITTED');
    return prisma.storeRequisition.update({
        where: { id },
        data: { status: 'APPROVED', approvedBy: userId, approvedAt: new Date(), remarks: comment, updatedAt: new Date() },
    });
};

const rejectRequisition = async (id, tenantId, userId, reason) => {
    if (!reason) throw Object.assign(new Error('Rejection reason is required'), { status: 400 });
    await assertReqStatus(id, tenantId, 'SUBMITTED');
    return prisma.storeRequisition.update({
        where: { id },
        data: { status: 'REJECTED', rejectedBy: userId, rejectionReason: reason, updatedAt: new Date() },
    });
};

// ─── Queries ─────────────────────────────────────────────────────────────────

const listRequisitions = async (tenantId, { status, departmentName, locationId, dateFrom, dateTo, page = 1, limit = 20 } = {}) => {
    const where = {
        tenantId,
        ...(status ? { status } : {}),
        ...(departmentName ? { departmentName: { contains: departmentName, mode: 'insensitive' } } : {}),
        ...(locationId ? { locationId } : {}),
        ...(dateFrom || dateTo ? {
            requestDate: {
                ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
                ...(dateTo ? { lte: new Date(dateTo) } : {}),
            },
        } : {}),
    };

    const [total, data] = await Promise.all([
        prisma.storeRequisition.count({ where }),
        prisma.storeRequisition.findMany({
            where,
            include: {
                location: { select: { name: true } },
                requestedByUser: { select: { firstName: true, lastName: true } },
                _count: { select: { lines: true, issues: true } },
            },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);
    return { total, page, limit, data };
};

const getRequisition = async (id, tenantId) => {
    const req = await prisma.storeRequisition.findFirst({
        where: { id, tenantId },
        include: {
            location: { select: { name: true } },
            requestedByUser: { select: { firstName: true, lastName: true } },
            approvedByUser: { select: { firstName: true, lastName: true } },
            rejectedByUser: { select: { firstName: true, lastName: true } },
            lines: {
                include: {
                    item: { select: { name: true } },
                    uom: { select: { abbreviation: true } },
                },
            },
            issues: {
                include: {
                    issuedByUser: { select: { firstName: true, lastName: true } },
                    lines: true,
                },
                orderBy: { createdAt: 'desc' },
            },
        },
    });
    if (!req) throw Object.assign(new Error('Requisition not found'), { status: 404 });
    return req;
};

module.exports = {
    createRequisition,
    updateRequisition,
    deleteRequisition,
    submitRequisition,
    approveRequisition,
    rejectRequisition,
    listRequisitions,
    getRequisition,
};
