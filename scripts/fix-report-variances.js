const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        const reports = await prisma.savedStockReport.findMany({
            include: {
                lines: { include: { locationQtys: true, item: true } }
            }
        });

        for (const report of reports) {
            let overallVarRaw = 0;
            for (const line of report.lines) {
                let countedTotal = 0;
                let bookTotal = 0;
                for (const lq of line.locationQtys) {
                    countedTotal += Number(lq.countedQty != null ? lq.countedQty : lq.bookQty);
                    bookTotal += Number(lq.bookQty);
                }
                const varianceQty = countedTotal - bookTotal;
                const unitPrice = line.item ? Number(line.item.unitPrice || 0) : 0;
                const varianceValue = varianceQty * unitPrice;
                overallVarRaw += Math.abs(varianceValue);
            }

            if (Number(report.totalValue) !== overallVarRaw) {
                console.log(`Fixing report ${report.reportNo}: replacing ${report.totalValue} with ${overallVarRaw}`);
                await prisma.savedStockReport.update({
                    where: { id: report.id },
                    data: { totalValue: overallVarRaw }
                });
            }
        }
    } finally {
        await prisma.$disconnect();
    }
}
run();
