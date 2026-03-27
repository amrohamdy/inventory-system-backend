const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function prepare() {
    // Find Engineering Store
    const loc = await prisma.location.findFirst({ where: { name: 'Engineering Store' } });
    if (!loc) throw new Error("Location not found");

    // Find All-Purpose Cleaner 5L
    const item = await prisma.item.findFirst({ where: { name: 'All-Purpose Cleaner 5L' } });
    if (!item) throw new Error("Item not found");

    // Find Tenant
    const tenant = await prisma.tenant.findFirst();

    // Get current stock balance
    let balance = await prisma.stockBalance.findUnique({
        where: { tenantId_itemId_locationId: { tenantId: tenant.id, itemId: item.id, locationId: loc.id } }
    });

    console.log(`Current Balance: ${balance.qtyOnHand} at WAC ${balance.wacUnitCost}`);

    // If we want a clean 10, let's just make it 10 for the sake of the test
    if (Number(balance.qtyOnHand) !== 10) {
        await prisma.stockBalance.update({
            where: { id: balance.id },
            data: { qtyOnHand: 10, wacUnitCost: 50.00 }
        });
        console.log("Reset balance to 10 at WAC 50.00");
    }

    return { itemId: item.id, locationId: loc.id };
}

prepare().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
