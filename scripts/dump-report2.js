const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
    try {
        const report = await prisma.savedStockReport.findFirst({
            where: { reportNo: 'SRPT-2603-0002' },
            include: { lines: { include: { locationQtys: true, item: { select: { name: true, category: { select: { name: true } } } } } } }
        });
        console.log(JSON.stringify(report, null, 2));
    } finally {
        await prisma.$disconnect();
    }
}
run();
