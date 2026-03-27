const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        const lines = await prisma.savedStockReportLine.findMany({
            include: { locationQtys: true, item: true }
        });

        let updated = 0;
        for (const line of lines) {
            let countedTotal = 0;
            let bookTotal = 0;
            
            for (const lq of line.locationQtys) {
                countedTotal += Number(lq.countedQty != null ? lq.countedQty : lq.bookQty);
                bookTotal += Number(lq.bookQty);
            }

            const varianceQty = countedTotal - bookTotal;
            const unitPrice = line.item ? Number(line.item.unitPrice || 0) : 0;
            const varianceValue = varianceQty * unitPrice;
            const inwardValue = countedTotal * unitPrice;

            // Update only if it doesn't match
            if (Number(line.inwardQty) !== countedTotal || Number(line.outwardQty) !== varianceQty) {
                await prisma.savedStockReportLine.update({
                    where: { id: line.id },
                    data: {
                        inwardQty: countedTotal,
                        inwardValue: inwardValue,
                        outwardQty: varianceQty,
                        outwardValue: varianceValue
                    }
                });
                updated++;
            }
        }
        console.log(`Updated ${updated} report lines so they show up correctly in the interface.`);
    } finally {
        await prisma.$disconnect();
    }
}
run();
