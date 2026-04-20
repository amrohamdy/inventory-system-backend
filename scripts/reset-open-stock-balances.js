'use strict';

/**
 * One-off cleanup: while Opening Balance is OPEN, physical stock should live on DRAFT
 * movement_lines only; stock_balances.qtyOnHand should stay 0 until finalize.
 *
 * Sets qtyOnHand = 0 for all stock_balances rows belonging to tenants whose
 * allowOpeningBalance setting is OPEN.
 *
 * Usage:
 *   node scripts/reset-open-stock-balances.js
 *   DRY_RUN=1 node scripts/reset-open-stock-balances.js
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

async function main() {
    const openRows = await prisma.tenantSetting.findMany({
        where: { key: 'allowOpeningBalance', value: 'OPEN' },
        select: { tenantId: true },
    });

    if (openRows.length === 0) {
        console.log('No tenants with allowOpeningBalance = OPEN. Nothing to do.');
        return;
    }

    const tenantIds = openRows.map((r) => r.tenantId);
    console.log(`Tenants in OPEN phase: ${tenantIds.length}`);

    const countBefore = await prisma.stockBalance.count({
        where: { tenantId: { in: tenantIds }, qtyOnHand: { not: 0 } },
    });
    console.log(`stock_balances rows with non-zero qtyOnHand (OPEN tenants): ${countBefore}`);

    if (dryRun) {
        console.log('DRY_RUN=1 — no updates performed.');
        return;
    }

    const result = await prisma.stockBalance.updateMany({
        where: { tenantId: { in: tenantIds } },
        data: { qtyOnHand: 0 },
    });

    console.log(`Updated ${result.count} stock_balances row(s): qtyOnHand set to 0.`);
}

main()
    .catch((err) => {
        console.error('reset-open-stock-balances failed:', err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
