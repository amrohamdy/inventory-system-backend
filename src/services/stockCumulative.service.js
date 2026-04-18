'use strict';

/**
 * Increment cumulative loss counters on stock_balances (paired with ledger + on-hand rules in callers).
 * Uses upsert when no balance row exists (e.g. get-pass return finalized after qty already left the bin).
 */
const stockKey = (tenantId, itemId, locationId) => ({
    tenantId_itemId_locationId: { tenantId, itemId, locationId },
});

async function incrementTotalQtyDamage(tx, tenantId, itemId, locationId, qty) {
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) return;

    const key = stockKey(tenantId, itemId, locationId);
    const existing = await tx.stockBalance.findUnique({ where: key });
    if (existing) {
        await tx.stockBalance.update({
            where: key,
            data: { totalQtyDamage: { increment: q } },
        });
        return;
    }
    await tx.stockBalance.create({
        data: {
            tenantId,
            itemId,
            locationId,
            totalQtyDamage: q,
        },
    });
}

async function incrementTotalQtyLost(tx, tenantId, itemId, locationId, qty) {
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) return;

    const key = stockKey(tenantId, itemId, locationId);
    const existing = await tx.stockBalance.findUnique({ where: key });
    if (existing) {
        await tx.stockBalance.update({
            where: key,
            data: { totalQtyLost: { increment: q } },
        });
        return;
    }
    await tx.stockBalance.create({
        data: {
            tenantId,
            itemId,
            locationId,
            totalQtyLost: q,
        },
    });
}

module.exports = {
    incrementTotalQtyDamage,
    incrementTotalQtyLost,
};
