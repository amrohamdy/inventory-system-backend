const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function getJSON() {
    const session = await prisma.stockCountSession.findFirst({
        where: { sessionNo: 'CNT-2602-0004' },
        include: {
            lines: { include: { item: true } },
            location: true,
            approvalRequest: {
                include: { steps: { include: { actedByUser: true } } }
            }
        }
    });

    const entries = await prisma.inventoryLedger.findMany({
        where: { referenceId: session.id }
    });

    const pack = {
        sessionInfo: {
            sessionNo: session.sessionNo,
            status: session.status,
            location: session.location.name,
            snapshotTakenAt: session.snapshotAt
        },
        lines: session.lines.map(l => ({
            item: l.item.name,
            bookQty: Number(l.bookQty),
            countedQty: Number(l.countedQty),
            varianceQty: Number(l.varianceQty),
            varianceValue: Number(l.varianceValue)
        })),
        ledgerImpact: entries.map(e => ({
            type: e.movementType,
            qtyIn: Number(e.qtyIn),
            qtyOut: Number(e.qtyOut)
        }))
    };

    console.log(JSON.stringify(pack, null, 2));
}

getJSON().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
