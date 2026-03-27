// Test what the items API actually returns for stockBalances
const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();

const ITEM_INCLUDE = {
    department: { select: { id: true, name: true, code: true } },
    category: { select: { id: true, name: true } },
    subcategory: { select: { id: true, name: true } },
    supplier: { select: { id: true, name: true } },
    defaultStore: { select: { id: true, name: true, departmentId: true } },
    itemUnits: { include: { unit: { select: { id: true, name: true, abbreviation: true } } } },
    stockBalances: { select: { qtyOnHand: true, location: { select: { id: true, name: true } } } },
};

async function main() {
    const items = await p.item.findMany({
        where: { isActive: true },
        include: ITEM_INCLUDE,
        take: 5
    });
    
    console.log('\nAPI response simulation:');
    items.forEach(item => {
        const sb = item.stockBalances;
        console.log(`\n  Item: ${item.name.substring(0,40)}`);
        console.log(`  stockBalances count: ${sb.length}`);
        if (sb.length > 0) {
            sb.forEach(b => {
                console.log(`    qtyOnHand: ${b.qtyOnHand} (type: ${typeof b.qtyOnHand})`);
                console.log(`    parseFloat: ${parseFloat(b.qtyOnHand)}`);
            });
        }
        
        // Simulate JSON serialization (what the API actually sends)
        const serialized = JSON.parse(JSON.stringify(item));
        const totalQty = (serialized.stockBalances || []).reduce((s, b) => s + (parseFloat(b.qtyOnHand) || 0), 0);
        console.log(`  → Total Qty after JSON serialization: ${totalQty}`);
    });
    
    await p.$disconnect();
}
main().catch(console.error);
