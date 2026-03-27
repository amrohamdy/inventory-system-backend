const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const XLSX = require('xlsx');

// ── GET CONSUMPTION REPORT ────────────────────────────────────────────────────
const getConsumptionReport = async (tenantId, { departmentId, locationId, categoryId, dateFrom, dateTo }) => {
    if (!dateFrom || !dateTo) throw Object.assign(new Error('Date range is required'), { status: 400 });

    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);

    // Build location filter
    let locationIds = null;
    if (locationId) {
        locationIds = [locationId];
    } else if (departmentId) {
        const locs = await prisma.location.findMany({
            where: { tenantId, departmentId, isActive: true },
            select: { id: true },
        });
        locationIds = locs.map(l => l.id);
    }

    // Get ISSUE movements (consumption = items issued out)
    const ledgerWhere = {
        tenantId,
        movementType: 'ISSUE',
        createdAt: { gte: from, lte: to },
    };
    if (locationIds) ledgerWhere.locationId = { in: locationIds };

    const ledger = await prisma.inventoryLedger.findMany({
        where: ledgerWhere,
        include: {
            item: {
                select: {
                    id: true, name: true, barcode: true, unitPrice: true,
                    category: { select: { name: true } },
                    department: { select: { name: true } },
                    supplier: { select: { name: true } },
                },
            },
            location: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
    });

    // Aggregate by item
    const itemAgg = {};
    for (const entry of ledger) {
        const key = entry.itemId;
        if (!itemAgg[key]) {
            itemAgg[key] = {
                itemId: entry.item.id,
                name: entry.item.name,
                barcode: entry.item.barcode,
                category: entry.item.category?.name || '',
                department: entry.item.department?.name || '',
                supplier: entry.item.supplier?.name || '',
                unitPrice: Number(entry.item.unitPrice || 0),
                totalQty: 0,
                totalValue: 0,
                locations: {},
                transactions: 0,
            };
        }
        const qty = Number(entry.qtyOut || 0);
        const value = Number(entry.totalValue || 0) || qty * Number(entry.unitCost || 0);
        itemAgg[key].totalQty += qty;
        itemAgg[key].totalValue += Math.abs(value);
        itemAgg[key].transactions++;

        // Track per location
        const locName = entry.location?.name || 'Unknown';
        itemAgg[key].locations[locName] = (itemAgg[key].locations[locName] || 0) + qty;
    }

    // Filter by category if specified
    let items = Object.values(itemAgg);
    if (categoryId) {
        // Need to check category — fetch item categoryIds
        const catItems = await prisma.item.findMany({
            where: { tenantId, categoryId },
            select: { id: true },
        });
        const catIds = new Set(catItems.map(i => i.id));
        items = items.filter(i => catIds.has(i.itemId));
    }

    // Sort by total value descending (highest consumption first)
    items.sort((a, b) => b.totalValue - a.totalValue);

    // Add serial numbers
    items.forEach((item, idx) => { item.sr = idx + 1; });

    // Totals
    const totals = {
        totalQty: items.reduce((s, i) => s + i.totalQty, 0),
        totalValue: items.reduce((s, i) => s + i.totalValue, 0),
        transactions: items.reduce((s, i) => s + i.transactions, 0),
        itemCount: items.length,
    };

    return { items, totals, dateFrom, dateTo };
};

// ── EXPORT TO EXCEL ───────────────────────────────────────────────────────────
const exportToExcel = async (tenantId, params) => {
    const report = await getConsumptionReport(tenantId, params);

    const rows = report.items.map(item => ({
        'SR': item.sr,
        'Department': item.department,
        'Category': item.category,
        'Supplier': item.supplier,
        'Item': item.name,
        'Barcode': item.barcode || '',
        'Unit Price': item.unitPrice,
        'Consumed Qty': item.totalQty,
        'Total Value (SAR)': item.totalValue,
        'Transactions': item.transactions,
    }));

    // Add totals row
    rows.push({
        'SR': '', 'Department': '', 'Category': '', 'Supplier': '',
        'Item': 'TOTALS', 'Barcode': '',
        'Unit Price': '',
        'Consumed Qty': report.totals.totalQty,
        'Total Value (SAR)': report.totals.totalValue,
        'Transactions': report.totals.transactions,
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
        { wch: 5 }, { wch: 18 }, { wch: 16 }, { wch: 18 },
        { wch: 30 }, { wch: 14 }, { wch: 10 }, { wch: 12 },
        { wch: 16 }, { wch: 12 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Consumption Report');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

module.exports = { getConsumptionReport, exportToExcel };
