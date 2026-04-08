const prisma = require('../config/database');

function badRequest(message) {
    const e = new Error(message);
    e.statusCode = 400;
    return e;
}

// ── GET PAR LEVELS FOR A LOCATION ─────────────────────────────────────────────
const getParLevels = async (tenantId, locationId, { categoryId } = {}) => {
    const where = { tenantId, locationId };
    if (categoryId) {
        where.item = { categoryId };
    }
    return prisma.stockBalance.findMany({
        where,
        include: {
            item: {
                select: {
                    id: true, name: true, barcode: true, imageUrl: true, unitPrice: true,
                    categoryId: true,
                    category: { select: { id: true, name: true } },
                }
            },
            location: { select: { id: true, name: true } },
        },
        orderBy: { item: { name: 'asc' } },
    });
};

// ── UPDATE PAR LEVELS ─────────────────────────────────────────────────────────
// updates = [{ itemId, locationId?, minQty, maxQty, reorderPoint }] — all rows must belong to `locationId` (tenant from JWT only).
const updateParLevels = async (tenantId, locationId, updates) => {
    if (!locationId) throw badRequest('locationId is required');
    if (!Array.isArray(updates) || updates.length === 0) throw badRequest('updates must be a non-empty array');

    const location = await prisma.location.findFirst({
        where: { id: locationId, tenantId },
        select: { id: true },
    });
    if (!location) throw badRequest('Location not found or does not belong to this tenant');

    const itemIds = updates.map((u) => u.itemId).filter(Boolean);
    if (itemIds.length !== updates.length) throw badRequest('Each update must include a valid itemId');
    if (new Set(itemIds).size !== itemIds.length) throw badRequest('Duplicate itemId in updates');

    for (const u of updates) {
        if (u.locationId !== undefined && u.locationId !== locationId) {
            throw badRequest(`locationId mismatch for item ${u.itemId}`);
        }
    }

    const existingRows = await prisma.stockBalance.findMany({
        where: { tenantId, locationId, itemId: { in: [...new Set(itemIds)] } },
        select: { itemId: true, minQty: true, maxQty: true, reorderPoint: true },
    });
    const byItemId = new Map(existingRows.map((r) => [r.itemId, r]));

    const num = (v) => {
        const n = typeof v === 'number' ? v : parseFloat(v);
        return Number.isFinite(n) ? n : NaN;
    };

    for (const u of updates) {
        const row = byItemId.get(u.itemId);
        if (!row) throw badRequest(`Stock balance not found for item at this location: ${u.itemId}`);

        const effMin = u.minQty !== undefined ? num(u.minQty) : num(row.minQty);
        const effMax = u.maxQty !== undefined ? num(u.maxQty) : num(row.maxQty);
        const effReorder = u.reorderPoint !== undefined ? num(u.reorderPoint) : num(row.reorderPoint);

        if ([effMin, effMax, effReorder].some((x) => Number.isNaN(x))) {
            throw badRequest(`Invalid Par Levels for Item ID: ${u.itemId}`);
        }
        if (effMax > 0 && effMin > effMax) {
            throw badRequest(`Invalid Par Levels for Item ID: ${u.itemId}`);
        }
        if (effMax > 0 && effReorder > effMax) {
            throw badRequest(`Invalid Par Levels for Item ID: ${u.itemId}`);
        }
    }

    const ops = updates.map((u) =>
        prisma.stockBalance.update({
            where: {
                tenantId_itemId_locationId: {
                    tenantId,
                    itemId: u.itemId,
                    locationId,
                },
            },
            data: {
                ...(u.minQty !== undefined && { minQty: u.minQty }),
                ...(u.maxQty !== undefined && { maxQty: u.maxQty }),
                ...(u.reorderPoint !== undefined && { reorderPoint: u.reorderPoint }),
            },
        })
    );

    await prisma.$transaction(ops);
    return { updated: updates.length };
};

// ── CHECK LOW STOCK ───────────────────────────────────────────────────────────
// Returns items where qtyOnHand <= reorderPoint (and reorderPoint > 0)
const checkLowStock = async (tenantId, locationId) => {
    const where = { tenantId };
    if (locationId) where.locationId = locationId;

    const balances = await prisma.stockBalance.findMany({
        where: {
            ...where,
            OR: [
                { reorderPoint: { gt: 0 } },
                { minQty: { gt: 0 } },
                { maxQty: { gt: 0 } }
            ]
        },
        include: {
            item: { select: { id: true, name: true, barcode: true, imageUrl: true, unitPrice: true, department: { select: { name: true } } } },
            location: { select: { id: true, name: true } },
        },
    });

    return balances.filter(b => {
        const qty = parseFloat(b.qtyOnHand) || 0;
        const reorder = parseFloat(b.reorderPoint) || 0;
        const min = parseFloat(b.minQty) || 0;
        // At or below reorder point; strictly below minimum safety stock
        return (reorder > 0 && qty <= reorder) || (min > 0 && qty < min);
    });
};

module.exports = {
    getParLevels,
    updateParLevels,
    checkLowStock,
};
