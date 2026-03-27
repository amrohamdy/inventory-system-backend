const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fix() {
    const drafts = await prisma.savedStockReport.findMany({
        where: { status: 'DRAFT' },
        include: { lines: true }
    });

    for (let r of drafts) {
        let totalPhys = 0;
        for (let l of r.lines) {
            const book = Number(l.closingQty || 0);
            const count = Number(l.inwardQty || 0);
            const varQty = count - book;

            const openQty = Number(l.openingQty || 0);
            const countVal = Number(l.inwardValue || 0);
            const openVal = Number(l.openingValue || 0);
            const unitPrice = count !== 0 ? countVal / count : (openQty !== 0 ? openVal / openQty : 0);

            const varVal = varQty * unitPrice;
            totalPhys += Math.abs(varVal);

            await prisma.savedStockReportLine.update({
                where: { id: l.id },
                data: { outwardQty: varQty, outwardValue: varVal }
            });
        }
        await prisma.savedStockReport.update({
            where: { id: r.id },
            data: { totalValue: totalPhys }
        });
    }
    console.log('Fixed', drafts.length, 'drafts');
}

fix().finally(() => prisma.$disconnect());
