const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.stockBalance.findMany({
    where: { OR: [{ minQty: { gt: 0 } }, { reorderPoint: { gt: 0 } }, { maxQty: { gt: 0 } }] },
    include: { item: { select: { name: true } }, location: { select: { name: true } } }
}).then(rows => {
    if (rows.length === 0) { console.log('No par levels set'); return; }
    rows.forEach(b => console.log(
        b.item?.name, '|', b.location?.name,
        '| qty:', parseFloat(b.qtyOnHand),
        '| min:', parseFloat(b.minQty),
        '| max:', parseFloat(b.maxQty),
        '| reorder:', parseFloat(b.reorderPoint),
        '| ALERT?', (parseFloat(b.reorderPoint) > 0 && parseFloat(b.qtyOnHand) <= parseFloat(b.reorderPoint)) || (parseFloat(b.minQty) > 0 && parseFloat(b.qtyOnHand) <= parseFloat(b.minQty))
    ));
}).catch(e => console.error(e.message)).finally(() => p.$disconnect());
