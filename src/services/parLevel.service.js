const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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
const updateParLevels = async (tenantId, updates) => {
    // updates = [{ itemId, locationId, minQty, maxQty, reorderPoint }]
    let count = 0;
    for (const u of updates) {
        await prisma.stockBalance.update({
            where: {
                tenantId_itemId_locationId: {
                    tenantId,
                    itemId: u.itemId,
                    locationId: u.locationId,
                },
            },
            data: {
                ...(u.minQty !== undefined && { minQty: u.minQty }),
                ...(u.maxQty !== undefined && { maxQty: u.maxQty }),
                ...(u.reorderPoint !== undefined && { reorderPoint: u.reorderPoint }),
            },
        });
        count++;
    }
    return { updated: count };
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
        // Strictly below min (not AT min), or strictly below reorder point
        return (reorder > 0 && qty < reorder) || (min > 0 && qty < min);
    });
};

module.exports = {
    getParLevels,
    updateParLevels,
    checkLowStock,
};
