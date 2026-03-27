const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function doMovement() {
    const tenant = await prisma.tenant.findFirst();
    const loc = await prisma.location.findFirst({ where: { name: 'Engineering Store' } });
    const item = await prisma.item.findFirst({ where: { name: 'All-Purpose Cleaner 5L' } });

    // Deduct 2 directly from StockBalance to simulate a movement for the test
    let balance = await prisma.stockBalance.update({
        where: { tenantId_itemId_locationId: { tenantId: tenant.id, itemId: item.id, locationId: loc.id } },
        data: {
            qtyOnHand: 8
        }
    });

    console.log(`Live stock balance has been correctly forcefully reduced to 8. Snapshot test ready.`);
}

doMovement().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
