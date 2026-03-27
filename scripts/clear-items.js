const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('🗑️  Clearing all items and related data...');

    // Delete in correct order to respect foreign keys
    const d1 = await prisma.itemUnit.deleteMany({});
    console.log(`  ✅ Deleted ${d1.count} item units`);

    const d2 = await prisma.stockBalance.deleteMany({});
    console.log(`  ✅ Deleted ${d2.count} stock balances`);

    const d3 = await prisma.inventoryLedger.deleteMany({});
    console.log(`  ✅ Deleted ${d3.count} ledger entries`);

    const d4 = await prisma.movementLine.deleteMany({});
    console.log(`  ✅ Deleted ${d4.count} movement lines`);

    const d5 = await prisma.stockCountLine.deleteMany({});
    console.log(`  ✅ Deleted ${d5.count} stock count lines`);

    const d6 = await prisma.storeRequisitionLine.deleteMany({});
    console.log(`  ✅ Deleted ${d6.count} requisition lines`);

    const d7 = await prisma.storeIssueLine.deleteMany({});
    console.log(`  ✅ Deleted ${d7.count} issue lines`);

    const d8 = await prisma.storeTransferLine.deleteMany({});
    console.log(`  ✅ Deleted ${d8.count} transfer lines`);

    const d9 = await prisma.item.deleteMany({});
    console.log(`  ✅ Deleted ${d9.count} items`);

    console.log('\n✅ All items cleared! You can now add fresh items.');
}

main()
    .catch((e) => { console.error('❌ Error:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
