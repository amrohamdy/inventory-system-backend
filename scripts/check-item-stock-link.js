const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
async function main() {
    // Get items with their stock balances
    const items = await p.item.findMany({
        include: {
            stockBalances: { select: { qtyOnHand: true, locationId: true } }
        }
    });
    console.log('\nItems and their stockBalances:');
    items.forEach(item => {
        const totalQty = item.stockBalances.reduce((s, b) => s + Number(b.qtyOnHand || 0), 0);
        console.log(`  ${item.name.substring(0,35).padEnd(35)} | stockBalances: ${item.stockBalances.length} | totalQty: ${totalQty}`);
    });

    // Check if stockBalances itemIds match items table
    const allSB = await p.stockBalance.findMany({ select: { itemId: true, qtyOnHand: true } });
    const itemIds = new Set(items.map(i => i.id));
    const orphaned = allSB.filter(sb => !itemIds.has(sb.itemId));
    console.log(`\nOrphaned stock balances (no matching item): ${orphaned.length}`);
    console.log(`Total stock balances: ${allSB.length}`);
    await p.$disconnect();
}
main().catch(console.error);
