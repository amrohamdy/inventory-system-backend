'use strict';

const prisma = require('../config/database');
const { generateDocNumber } = require('./docNumbering.service');

const LOST_INCLUDE = {
    createdByUser: { select: { id: true, firstName: true, lastName: true } },
    getPass: { select: { id: true, passNo: true } },
    lines: {
        include: {
            item: { select: { id: true, name: true, barcode: true } },
            location: { select: { id: true, name: true } },
        },
    },
};

const LOST_FLOW = [
    { status: 'DRAFT', nextStatus: 'DEPT_APPROVED', role: 'DEPT_MANAGER' },
    { status: 'DEPT_APPROVED', nextStatus: 'COST_CONTROL_APPROVED', role: 'COST_CONTROL' },
    { status: 'COST_CONTROL_APPROVED', nextStatus: 'FINANCE_APPROVED', role: 'FINANCE_MANAGER' },
    { status: 'FINANCE_APPROVED', nextStatus: 'APPROVED', role: 'GENERAL_MANAGER' },
];

const err = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

const ensureCanApprove = (doc, userRole) => {
    const current = LOST_FLOW.find((s) => s.status === doc.status);
    if (!current) throw err(`Document status ${doc.status} is not approvable.`);
    if (userRole !== current.role && userRole !== 'ADMIN' && userRole !== 'ORG_MANAGER') {
        throw err(`Status ${doc.status} requires role ${current.role}.`, 403);
    }
    return current;
};

const listLostItems = async (tenantId, query = {}) => {
    const skipN = Number.parseInt(String(query.skip ?? 0), 10) || 0;
    const takeN = Math.min(Number.parseInt(String(query.take ?? 20), 10) || 20, 100);
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const status = typeof query.status === 'string' ? query.status.trim() : '';
    const sourceType = typeof query.sourceType === 'string' ? query.sourceType.trim() : '';

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
        ...(status ? { status } : {}),
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

    const [documents, total] = await Promise.all([
        prisma.movementDocument.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: skipN,
            take: takeN,
            include: {
                createdByUser: { select: { id: true, firstName: true, lastName: true } },
                getPass: { select: { id: true, passNo: true } },
                lines: {
                    select: {
                        qtyInBaseUnit: true,
                        item: { select: { id: true, name: true, barcode: true } },
                    },
                },
                _count: { select: { lines: true } },
            },
        }),
        prisma.movementDocument.count({ where }),
    ]);

    const items = documents.map((doc) => {
        const qtyLost = doc.lines.reduce((sum, line) => sum + Number(line.qtyInBaseUnit || 0), 0);
        const firstLine = doc.lines[0];
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
            qtyLost,
            _count: doc._count,
        };
    });

    return { items, total };
};

const createLost = async (tenantId, userId, body = {}) => {
    const { lines = [], reason, notes, sourceLocationId, documentDate } = body;
    if (!reason?.trim()) throw err('Reason is required.');
    if (!sourceLocationId) throw err('Location is required.');
    if (!Array.isArray(lines) || lines.length === 0) throw err('At least one line is required.');

    const location = await prisma.location.findFirst({ where: { id: sourceLocationId, tenantId } });
    if (!location) throw err('Location not found.', 404);

    const documentNo = await generateDocNumber(tenantId, 'LST', new Date());

    return prisma.movementDocument.create({
        data: {
            tenantId,
            documentNo,
            movementType: 'LOST',
            sourceType: 'INTERNAL',
            status: 'DRAFT',
            sourceLocationId,
            reason: reason.trim(),
            notes: notes?.trim() || null,
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
        include: LOST_INCLUDE,
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
            data: { qtyOnHand: { decrement: qty } },
        });
    }
};

const approveLostAtLevel = async (id, tenantId, userId, userRole, expectedStatus) => {
    const doc = await getLostById(id, tenantId);
    if (doc.sourceType !== 'INTERNAL') throw err('Only internal lost documents can be approved manually.');
    if (doc.status !== expectedStatus) throw err(`Document must be in ${expectedStatus} status.`);
    const current = ensureCanApprove(doc, userRole);

    return prisma.$transaction(async (tx) => {
        const isFinal = current.nextStatus === 'APPROVED';
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

module.exports = {
    listLostItems,
    createLost,
    getLostById,
    approveLostAtLevel,
};
