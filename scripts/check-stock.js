const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
async function main() {
    const sb = await p.stockBalance.findMany({
        include: { item: { select: { name: true } }, location: { select: { name: true } } }
    });
    console.log('\nStock Balances:');
    sb.forEach(s => console.log(`  ${s.item.name.substring(0,30).padEnd(30)} | ${s.location.name.padEnd(20)} | Qty: ${Number(s.qtyOnHand)}`));
    console.log(`\nTotal records: ${sb.length}`);
    await p.$disconnect();
}
main().catch(console.error);
