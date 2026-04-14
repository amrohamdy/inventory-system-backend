const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const settingService = require('./setting.service');

/**
 * Get ledger entries with full filtering and pagination.
 * Supports: itemId, locationId, dateFrom, dateTo, movementDocumentId, movementType
 */
const getLedgerEntries = async (tenantId, query = {}) => {
    const obStatus = await settingService.getObStatus(tenantId);
    if (obStatus !== 'FINALIZED') {
        return {
            entries: [],
            total: 0,
            status: 'SETUP_IN_PROGRESS',
            obStatus,
        };
    }

    const {
        skip = 0,
        take = 50,
        itemId,
        locationId,
        dateFrom,
        dateTo,
        movementDocumentId,
        movementType
    } = query;

    const where = {
        tenantId,
        ...(itemId && { itemId }),
        ...(locationId && { locationId }),
        ...(movementType && { movementType }),
        ...(movementDocumentId && { referenceId: movementDocumentId }),
        ...((dateFrom || dateTo) && {
            createdAt: {
                ...(dateFrom && { gte: new Date(dateFrom) }),
                ...(dateTo && { lte: new Date(dateTo + 'T23:59:59.999Z') })
            }
        })
    };

    const [entries, total] = await Promise.all([
        prisma.inventoryLedger.findMany({
            where,
            skip: parseInt(skip),
            take: parseInt(take),
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            include: {
                item: { select: { id: true, name: true, barcode: true } },
                location: { select: { id: true, name: true } },
                createdByUser: { select: { firstName: true, lastName: true } }
            }
        }),
        prisma.inventoryLedger.count({ where })
    ]);

    return { entries, total };
};

/**
 * Get ledger entries for a specific movement document (by referenceId).
 */
const getLedgerByDocument = async (documentId, tenantId) => {
    const obStatus = await settingService.getObStatus(tenantId);
    if (obStatus !== 'FINALIZED') {
        return [];
    }

    const entries = await prisma.inventoryLedger.findMany({
        where: {
            tenantId,
            referenceId: documentId
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: {
            item: { select: { id: true, name: true, barcode: true } },
            location: { select: { id: true, name: true } }
        }
    });

    return entries;
};

module.exports = {
    getLedgerEntries,
    getLedgerByDocument
};
