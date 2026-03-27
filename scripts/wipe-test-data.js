const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const tenantId = '56e26c19-aff4-4fd9-8d43-a3ed4dde89d5'; // Grand Horizon Hotel

    console.log(`Starting data wipe for tenant: ${tenantId}`);

    try {
        await prisma.$transaction([
            // Delete Reports
            prisma.generatedReport.deleteMany({ where: { tenantId } }),
            prisma.savedStockReportLocationQty.deleteMany({ where: { line: { report: { tenantId } } } }),
            prisma.savedStockReportLine.deleteMany({ where: { report: { tenantId } } }),
            prisma.savedStockReport.deleteMany({ where: { tenantId } }),

            // Delete Gate Passes
            prisma.getPassReturn.deleteMany({ where: { getPassLine: { getPass: { tenantId } } } }),
            prisma.getPassLine.deleteMany({ where: { getPass: { tenantId } } }),
            prisma.getPass.deleteMany({ where: { tenantId } }),

            // Delete Store Transfers / Issues / Requisitions
            prisma.storeTransferLine.deleteMany({ where: { transfer: { tenantId } } }),
            prisma.storeTransfer.deleteMany({ where: { tenantId } }),
            prisma.storeIssueLine.deleteMany({ where: { issue: { tenantId } } }),
            prisma.storeIssue.deleteMany({ where: { tenantId } }),
            prisma.storeRequisitionLine.deleteMany({ where: { requisition: { tenantId } } }),
            prisma.storeRequisition.deleteMany({ where: { tenantId } }),

            // Delete GRNs
            prisma.grnLine.deleteMany({ where: { grnImport: { tenantId } } }),
            prisma.grnImport.deleteMany({ where: { tenantId } }),

            // Delete Counts
            prisma.stockCountLine.deleteMany({ where: { session: { tenantId } } }),
            prisma.stockCountSession.deleteMany({ where: { tenantId } }),

            // Delete Movements (includes breakages, adjustments, GRNs, Issues, Transfers)
            prisma.movementLine.deleteMany({ where: { document: { tenantId } } }),
            prisma.movementDocument.deleteMany({ where: { tenantId } }),

            // Delete Imports
            prisma.importRow.deleteMany({ where: { session: { tenantId } } }),
            prisma.importSession.deleteMany({ where: { tenantId } }),

            // Delete Approval Workflow Items
            prisma.approvalStep.deleteMany({ where: { request: { tenantId } } }),
            prisma.approvalRequest.deleteMany({ where: { tenantId } }),

            // Delete Core Ledger and Balances
            prisma.inventoryLedger.deleteMany({ where: { tenantId } }),
            prisma.stockBalance.deleteMany({ where: { tenantId } }),

            // Delete Item Master
            prisma.itemUnit.deleteMany({ where: { tenantId } }),
            prisma.itemMapping.deleteMany({ where: { tenantId } }),
            prisma.item.deleteMany({ where: { tenantId } }),

            // Optional: reset Sequences if there are any
            prisma.docSequence.deleteMany({ where: { tenantId } })
        ]);
        console.log('✅ Successfully wiped all transactional and item data for the tenant.');
    } catch (e) {
        console.error('❌ Error wiping data:', e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
