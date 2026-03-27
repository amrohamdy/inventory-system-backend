const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Get ledger entries with full filtering and pagination.
 * Supports: itemId, locationId, dateFrom, dateTo, movementDocumentId, movementType
 */
const getLedgerEntries = async (tenantId, query = {}) => {
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
            orderBy: { createdAt: 'asc' },
            include: {
                item: { select: { id: true, name: true, barcode: true } },
                location: { select: { id: true, name: true } },
                createdByUser: { select: { firstName: true, lastName: true } }
            }
        }),
        prisma.inventoryLedger.count({ where })
    ]);

    // Calculate running balance per item+location combination
    const runningBalances = {};
    const entriesWithBalance = entries.map(entry => {
        const key = `${entry.itemId}-${entry.locationId}`;
        if (!runningBalances[key]) {
            runningBalances[key] = 0;
        }
        runningBalances[key] += Number(entry.qtyIn) - Number(entry.qtyOut);

        return {
            ...entry,
            runningBalance: runningBalances[key]
        };
    });

    return { entries: entriesWithBalance, total };
};

/**
 * Get ledger entries for a specific movement document (by referenceId).
 */
const getLedgerByDocument = async (documentId, tenantId) => {
    const entries = await prisma.inventoryLedger.findMany({
        where: {
            tenantId,
            referenceId: documentId
        },
        orderBy: { createdAt: 'asc' },
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
