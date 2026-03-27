'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verify() {
    const checks = [
        ['Stock Balances',     () => prisma.stockBalance.count()],
        ['Inventory Ledger',   () => prisma.inventoryLedger.count()],
        ['Movements (Doc)',    () => prisma.movementDocument.count()],
        ['Movement Lines',     () => prisma.movementLine.count()],
        ['GRN Records',        () => prisma.grnImport.count()],
        ['GRN Lines',          () => prisma.grnLine.count()],
        ['Transfers',          () => prisma.storeTransfer.count()],
        ['Requisitions',       () => prisma.storeRequisition.count()],
        ['Asset Loans',        () => prisma.assetLoan.count()],
        ['Approval Requests',  () => prisma.approvalRequest.count()],
        ['Stock Reports',      () => prisma.savedStockReport.count()],
        // Master data — should have records
        ['Users',              () => prisma.user.count()],
        ['Items',              () => prisma.item.count()],
        ['Locations',          () => prisma.location.count()],
        ['Suppliers',          () => prisma.supplier.count()],
    ];

    console.log('\n📊 Record counts after cleanup:\n');
    for (const [name, fn] of checks) {
        const count = await fn();
        const icon = count === 0 ? '✅' : (name === 'Users' || name === 'Items' || name === 'Locations' || name === 'Suppliers' ? '✅' : '⚠️ ');
        console.log(`  ${icon} ${name.padEnd(22)} : ${count}`);
    }
    console.log('');
}

verify().catch(console.error).finally(() => prisma.$disconnect());
