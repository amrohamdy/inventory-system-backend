const { PrismaClient } = require('@prisma/client');
const pdf = require('./src/services/pdf.service');
const prisma = new PrismaClient();

async function run() {
    const report = await prisma.savedStockReport.findFirst({
        include: {
            lines: {
                include: {
                    item: true,
                    locationQtys: { include: { location: true } }
                }
            },
            location: true,
            createdByUser: true,
            approvalRequest: {
                include: {
                    steps: {
                        orderBy: { actedAt: 'asc' },
                        include: { actedByUser: true }
                    }
                }
            }
        }
    });

    try {
        const buf = await pdf.generateStockReportVariancePDF(report);
        const fs = require('fs');
        fs.writeFileSync('test.pdf', buf);
        console.log("PDF generated successfully! Size:", buf.length);
    } catch (e) {
        console.error("PDF generation crashed:", e);
    }
}

run().finally(() => prisma.$disconnect());
