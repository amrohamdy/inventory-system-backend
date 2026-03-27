'use strict';
/**
 * Cleanup Script — Delete all transaction data, keep master data
 * Deletes: Ledger, Stock Balances, GRN, Transfers, Breakages,
 *          Asset Loans, Requisitions, Issues, Movements,
 *          Count Sessions, Approval Requests, Period Snapshots,
 *          Stock Reports, Generated Reports
 * Keeps:   Items, Locations, Users, Departments, Categories,
 *          Units, Suppliers, Tenants, Periods, Settings
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanup() {
    console.log('🧹 Starting system cleanup...\n');

    const steps = [
        // ── Reports & Snapshots ────────────────────────────────────────────
        ['Generated Reports',        () => prisma.generatedReport.deleteMany({})],
        ['Saved Stock Report Loc Qtys', () => prisma.savedStockReportLocationQty.deleteMany({})],
        ['Saved Stock Report Lines', () => prisma.savedStockReportLine.deleteMany({})],
        ['Saved Stock Reports',      () => prisma.savedStockReport.deleteMany({})],
        ['Period Snapshots',         () => prisma.periodSnapshot.deleteMany({})],

        // ── Approvals ──────────────────────────────────────────────────────
        ['Approval Steps',           () => prisma.approvalStep.deleteMany({})],
        ['Approval Requests',        () => prisma.approvalRequest.deleteMany({})],

        // ── Count Sessions ─────────────────────────────────────────────────
        ['Count Session Items',      () => prisma.stockCountItem.deleteMany({})],
        ['Count Sessions',           () => prisma.stockCountSession.deleteMany({})],

        // ── Asset Loans / Get Pass ─────────────────────────────────────────
        ['Asset Loans (Get Pass)',   () => prisma.assetLoan.deleteMany({})],

        // ── Breakage ───────────────────────────────────────────────────────
        ['Breakage Items',           () => prisma.breakageItem.deleteMany({})],
        ['Breakage Documents',       () => prisma.breakageDocument.deleteMany({})],

        // ── Inter-Store Transfers ──────────────────────────────────────────
        ['Transfer Lines',           () => prisma.storeTransferLine.deleteMany({})],
        ['Transfers',                () => prisma.storeTransfer.deleteMany({})],

        // ── Requisitions ───────────────────────────────────────────────────
        ['Requisition Lines',        () => prisma.storeRequisitionLine.deleteMany({})],
        ['Requisitions',             () => prisma.storeRequisition.deleteMany({})],

        // ── Store Issues ───────────────────────────────────────────────────
        ['Issue Lines',              () => prisma.storeIssueLine.deleteMany({})],
        ['Store Issues',             () => prisma.storeIssue.deleteMany({})],

        // ── GRN ────────────────────────────────────────────────────────────
        ['GRN Lines',                () => prisma.grnImportLine.deleteMany({})],
        ['GRN Records',              () => prisma.grnImport.deleteMany({})],

        // ── Movements ─────────────────────────────────────────────────────
        ['Movement Lines',           () => prisma.movementLine.deleteMany({})],
        ['Movements',                () => prisma.movement.deleteMany({})],

        // ── Import Sessions ────────────────────────────────────────────────
        ['Import Sessions',          () => prisma.importSession.deleteMany({})],

        // ── Ledger & Stock ─────────────────────────────────────────────────
        ['Inventory Ledger',         () => prisma.inventoryLedger.deleteMany({})],
        ['Stock Balances',           () => prisma.stockBalance.deleteMany({})],

        // ── Audit Trail ────────────────────────────────────────────────────
        ['Audit Trail',              () => prisma.auditTrail.deleteMany({})],

        // ── Notifications ──────────────────────────────────────────────────
        ['Notifications',            () => prisma.notification.deleteMany({})],
    ];

    let totalDeleted = 0;
    for (const [name, fn] of steps) {
        try {
            const result = await fn();
            const count = result?.count ?? '?';
            console.log(`  ✅ ${name.padEnd(35)} → ${count} records deleted`);
            if (typeof count === 'number') totalDeleted += count;
        } catch (err) {
            // Some tables might not exist yet — skip gracefully
            if (err.code === 'P2021' || err.message.includes('does not exist')) {
                console.log(`  ⏭️  ${name.padEnd(35)} → table not found, skipped`);
            } else {
                console.log(`  ⚠️  ${name.padEnd(35)} → ${err.message}`);
            }
        }
    }

    console.log(`\n🎉 Cleanup complete! Total records removed: ${totalDeleted}`);
    console.log('✅ Kept: Items, Locations, Users, Departments, Categories, Units, Suppliers, Periods, Settings\n');
}

cleanup()
    .catch(err => { console.error('❌ Fatal error:', err.message); process.exit(1); })
    .finally(() => prisma.$disconnect());
