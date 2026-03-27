const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    // Check GRN 55555
    const grn = await p.grnImport.findFirst({
        where: { grnNumber: '55555' },
        include: { lines: true }
    });
    if (!grn) { console.log('GRN 55555 not found'); return; }
    console.log('GRN Status:', grn.status);
    console.log('GRN ID:', grn.id);

    // Check ledger for this GRN
    const ledger = await p.inventoryLedger.findMany({
        where: { referenceId: grn.id },
        include: { item: { select: { name: true } }, location: { select: { name: true } } }
    });
    console.log('\nLedger entries:', ledger.length);
    ledger.forEach(l => console.log(' -', l.item?.name, '|', l.location?.name, '| qtyIn:', Number(l.qtyIn), '| type:', l.movementType));

    // Also check stock balance for the location
    const bal = await p.stockBalance.findMany({
        where: { locationId: grn.locationId },
        include: { item: { select: { name: true } } }
    });
    console.log('\nStock balances for location:');
    bal.forEach(b => console.log(' -', b.item?.name, '| qty:', Number(b.qtyOnHand)));
}

main().catch(e => console.error('❌', e.message)).finally(() => p.$disconnect());
