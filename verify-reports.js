const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const reportsService = require('./src/services/reports.service');
const excelService = require('./src/services/excel.service');
const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = 'C:\\Users\\amrsa\\.gemini\\antigravity\\brain\\4bea41b5-e695-4609-8130-59d38d55e5bb';

async function verifyReports() {
    try {
        const tenant = await prisma.tenant.findFirst();
        const loc = await prisma.location.findFirst({ where: { name: 'Engineering Store' } });
        const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });

        console.log("=== 1. STOCK VALUATION REPORT (JSON) ===");
        const valFilters = { locationId: loc.id };
        const valuationResult = await reportsService.getStockValuation(tenant.id, valFilters);
        console.log(JSON.stringify({ summary: valuationResult.summary, sampleItem: valuationResult.data[0] }, null, 2));

        console.log("\n=== 2. MOVEMENT HISTORY REPORT (JSON) ===");
        // Date range covering today
        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - 30);
        const dateTo = new Date();
        dateTo.setDate(dateTo.getDate() + 1);

        const movFilters = { dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString(), locationId: loc.id };
        const movementResult = await reportsService.getMovementHistory(tenant.id, movFilters);
        console.log(JSON.stringify({ summary: movementResult.summary, totalRecords: movementResult.total, sampleItem: movementResult.data[0] }, null, 2));

        console.log("\n=== 3. GENERATING EXCEL EXPORTS ===");

        // Save Valuation Excel
        const valColumns = [
            { header: 'Location', key: 'locationName', width: 25 },
            { header: 'Item Code', key: 'itemCode', width: 15 },
            { header: 'Item Name', key: 'itemName', width: 35 },
            { header: 'Category', key: 'category', width: 20 },
            { header: 'Qty On Hand', key: 'qtyOnHand', width: 15 },
            { header: 'WAC (SAR)', key: 'wacUnitCost', width: 15 },
            { header: 'Total Value (SAR)', key: 'totalValue', width: 20 }
        ];
        const valMeta = {
            generatedBy: `${admin.firstName} ${admin.lastName}`,
            generatedAt: new Date().toISOString(),
            filters: { location: loc.name }
        };
        const valBuffer = await excelService.generateExcelBuffer(valuationResult.data, valColumns, 'Stock Valuation', valMeta);
        const valPath = path.join(ARTIFACT_DIR, 'sample_valuation.xlsx');
        fs.writeFileSync(valPath, valBuffer);
        console.log(`Saved Stock Valuation Excel to: ${valPath}`);

        // Save Movement Excel
        const movColumns = [
            { header: 'Date', key: 'date', width: 25 },
            { header: 'Type', key: 'movementType', width: 20 },
            { header: 'Ref No', key: 'referenceNo', width: 20 },
            { header: 'Item Name', key: 'itemName', width: 35 },
            { header: 'Location', key: 'locationName', width: 25 },
            { header: 'Qty In', key: 'qtyIn', width: 15 },
            { header: 'Qty Out', key: 'qtyOut', width: 15 },
            { header: 'Unit Cost', key: 'unitCost', width: 15 },
            { header: 'Total Value', key: 'totalValue', width: 15 },
            { header: 'User', key: 'user', width: 25 }
        ];
        const movMeta = {
            generatedBy: `${admin.firstName} ${admin.lastName}`,
            generatedAt: new Date().toISOString(),
            filters: { dateFrom: movFilters.dateFrom, dateTo: movFilters.dateTo, location: loc.name }
        };
        // Format dates
        const formattedMovData = movementResult.data.map(d => ({ ...d, date: d.date.toLocaleString() }));
        const movBuffer = await excelService.generateExcelBuffer(formattedMovData, movColumns, 'Movement History', movMeta);
        const movPath = path.join(ARTIFACT_DIR, 'sample_movement.xlsx');
        fs.writeFileSync(movPath, movBuffer);
        console.log(`Saved Movement History Excel to: ${movPath}`);


        console.log("\n=== 4. RECONCILIATION PROOF ===");
        // Prove valuation total == current ledger sum for that location
        const itemIds = [...new Set(valuationResult.data.map(d => d.itemCode))]; // Just a heuristic, better to query directly

        const allBalances = await prisma.stockBalance.findMany({ where: { tenantId: tenant.id, locationId: loc.id } });
        let stockBalanceSum = 0;
        allBalances.forEach(b => stockBalanceSum += Number(b.qtyOnHand));

        const allLedgers = await prisma.inventoryLedger.findMany({ where: { tenantId: tenant.id, locationId: loc.id } });
        let ledgerSum = 0;
        allLedgers.forEach(l => {
            ledgerSum += Number(l.qtyIn);
            ledgerSum -= Number(l.qtyOut);
        });

        console.log(`StockBalance Qty Sum (Engineering Store): ${stockBalanceSum}`);
        console.log(`Ledger Qty(In-Out) Sum (Engineering Store): ${ledgerSum}`);
        console.log(`Reconciled: ${stockBalanceSum === ledgerSum ? '✅ YES' : '❌ NO'}`);

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

verifyReports();
