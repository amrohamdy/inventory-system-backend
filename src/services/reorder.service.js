const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Get reorder suggestions — items below reorder point with recommended order qty
 * Calculation: orderQty = maxQty - qtyOnHand (to fill up to max)
 * If no maxQty set, orderQty = reorderPoint * 2 - qtyOnHand
 */
const getReorderSuggestions = async (tenantId, { departmentId, locationId } = {}) => {
    const balances = await prisma.stockBalance.findMany({
        where: {
            tenantId,
            ...(locationId ? { locationId } : {}),
            OR: [
                { reorderPoint: { gt: 0 } },
                { minQty: { gt: 0 } },
                { maxQty: { gt: 0 } }
            ]
        },
        include: {
            item: {
                select: {
                    id: true, name: true, barcode: true, unitPrice: true,
                    category: { select: { name: true } },
                    department: { select: { id: true, name: true } },
                    supplier: { select: { name: true } },
                },
            },
            location: { select: { id: true, name: true } },
        },
    });

    // Filter by department if specified
    let filtered = balances;
    if (departmentId) {
        filtered = balances.filter(b => b.item.department?.id === departmentId);
    }

    // Only items at or below reorder point
    const suggestions = [];
    for (const bal of filtered) {
        const qty = Number(bal.qtyOnHand);
        const reorder = Number(bal.reorderPoint);
        const max = Number(bal.maxQty);
        const min = Number(bal.minQty);

        if ((reorder > 0 && qty <= reorder) || (min > 0 && qty <= min)) {
            const targetQty = max > 0 ? max : (reorder > 0 ? reorder * 2 : (min > 0 ? min * 2 : qty + 10));
            const orderQty = Math.max(0, targetQty - qty);
            const unitPrice = Number(bal.item.unitPrice || 0);

            suggestions.push({
                itemId: bal.itemId,
                locationId: bal.locationId,
                itemName: bal.item.name,
                barcode: bal.item.barcode,
                category: bal.item.category?.name || '',
                department: bal.item.department?.name || '',
                supplier: bal.item.supplier?.name || '',
                locationName: bal.location.name,
                currentQty: qty,
                minQty: min,
                maxQty: max,
                reorderPoint: reorder,
                suggestedOrderQty: orderQty,
                estimatedCost: orderQty * unitPrice,
                unitPrice,
                priority: qty === 0 ? 'CRITICAL' : qty <= min ? 'HIGH' : 'MEDIUM',
            });
        }
    }

    // Sort: CRITICAL first, then HIGH, then MEDIUM
    const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
    suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    const totals = {
        totalItems: suggestions.length,
        totalOrderQty: suggestions.reduce((s, i) => s + i.suggestedOrderQty, 0),
        totalEstimatedCost: suggestions.reduce((s, i) => s + i.estimatedCost, 0),
        critical: suggestions.filter(s => s.priority === 'CRITICAL').length,
        high: suggestions.filter(s => s.priority === 'HIGH').length,
    };

    return { suggestions, totals };
};

module.exports = { getReorderSuggestions };
