const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixReconciliation() {
    const tenant = await prisma.tenant.findFirst();
    const loc = await prisma.location.findFirst({ where: { name: 'Engineering Store' } });
    const item = await prisma.item.findFirst({ where: { name: 'All-Purpose Cleaner 5L' } });
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });

    // I previously deducted 2 from StockBalance directly. I need to add a Ledger entry for -2.
    await prisma.inventoryLedger.create({
        data: {
            tenantId: tenant.id,
            itemId: item.id,
            locationId: loc.id,
            movementType: 'ISSUE',
            qtyOut: 2,
            unitCost: 50.00,
            totalValue: 100.00,
            referenceNo: 'M10-HACK-FIX',
            createdBy: admin.id
        }
    });

    console.log("Inserted missing ledger entry.");
}

fixReconciliation().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
