const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const XLSX = require('xlsx');
const emailService = require('./email.service');
const { connectRole } = require('./rbac.service');

// ── GET STOCK REPORT ──────────────────────────────────────────────────────────
const getStockReport = async (tenantId, { departmentId, categoryId, year }) => {
    if (!departmentId) throw Object.assign(new Error('Department is required'), { status: 400 });

    const periodYear = parseInt(year) || new Date().getFullYear();
    const periodStart = new Date(`${periodYear}-01-01T00:00:00.000Z`);
    const periodEnd = new Date(`${periodYear + 1}-01-01T00:00:00.000Z`);

    // 1. Get locations linked to this department (and optionally category)
    const locWhere = { tenantId, departmentId, isActive: true };
    if (categoryId) {
        locWhere.locationCategories = { some: { categoryId } };
    }

    let locations = await prisma.location.findMany({
        where: locWhere,
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
    });

    // Fallback: If no locations are mapped explicitly to the category, 
    // fall back to all active locations in the department so we don't hide items maliciously.
    if (locations.length === 0) {
        locations = await prisma.location.findMany({
            where: { tenantId, departmentId, isActive: true },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        });
    }

    if (locations.length === 0) {
        return { items: [], locations: [], totals: {}, year: periodYear };
    }

    const locationIds = locations.map(l => l.id);

    // 2. Get items matching department (and optionally category)
    const itemWhere = { tenantId, departmentId, isActive: true };
    if (categoryId) itemWhere.categoryId = categoryId;

    const items = await prisma.item.findMany({
        where: itemWhere,
        include: {
            category: { select: { name: true } },
            supplier: { select: { name: true } },
        },
        orderBy: [{ supplier: { name: 'asc' } }, { category: { name: 'asc' } }, { name: 'asc' }],
    });

    if (items.length === 0) {
        return { items: [], locations, totals: {}, year: periodYear };
    }

    const itemIds = items.map(i => i.id);

    // 3. Get CURRENT stock balances per item per location (= Close Stock)
    const balances = await prisma.stockBalance.findMany({
        where: {
            tenantId,
            itemId: { in: itemIds },
            locationId: { in: locationIds },
        },
    });

    // Build balance map: itemId → locationId → qty
    const balanceMap = {};
    for (const b of balances) {
        if (!balanceMap[b.itemId]) balanceMap[b.itemId] = {};
        balanceMap[b.itemId][b.locationId] = Number(b.qtyOnHand);
    }

    // 4. Calculate OPENING BALANCE per item
    //    Priority: PeriodSnapshot (from year-end close) > Ledger calculation
    const openingMap = {};

    // Try PeriodSnapshot first (from previous year's close)
    const prevYearClose = await prisma.periodClose.findFirst({
        where: { tenantId, year: periodYear - 1, month: null, status: 'CLOSED' },
    });
    const decClose = !prevYearClose ? await prisma.periodClose.findFirst({
        where: { tenantId, year: periodYear - 1, month: 12, status: 'CLOSED' },
    }) : null;
    const closeId = prevYearClose?.id || decClose?.id;

    if (closeId) {
        // Use period snapshot for opening balance
        const snapshots = await prisma.periodSnapshot.findMany({
            where: {
                periodCloseId: closeId,
                itemId: { in: itemIds },
                locationId: { in: locationIds },
            },
        });
        for (const snap of snapshots) {
            openingMap[snap.itemId] = (openingMap[snap.itemId] || 0) + Number(snap.closingQty);
        }
    } else {
        // Fallback: calculate from ledger entries before period start,
        // PLUS any 'OPENING_BALANCE' entries created during this year
        // (to handle mid-year go-lives where OB is imported after Jan 1).
        const openingRaw = await prisma.inventoryLedger.groupBy({
            by: ['itemId'],
            where: {
                tenantId,
                itemId: { in: itemIds },
                locationId: { in: locationIds },
                OR: [
                    { createdAt: { lt: periodStart } },
                    {
                        movementType: 'OPENING_BALANCE',
                        createdAt: { gte: periodStart, lt: periodEnd }
                    }
                ]
            },
            _sum: { qtyIn: true, qtyOut: true },
        });
        for (const row of openingRaw) {
            openingMap[row.itemId] = Number(row._sum.qtyIn || 0) - Number(row._sum.qtyOut || 0);
        }
    }

    // 5. Get BREAKAGES and GRN (Purchases) during the period
    const [breakageRaw, grnRaw] = await Promise.all([
        prisma.inventoryLedger.groupBy({
            by: ['itemId'],
            where: {
                tenantId,
                itemId: { in: itemIds },
                locationId: { in: locationIds },
                movementType: 'BREAKAGE',
                createdAt: { gte: periodStart, lt: periodEnd },
            },
            _sum: { qtyOut: true, totalValue: true },
        }),
        prisma.inventoryLedger.groupBy({
            by: ['itemId'],
            where: {
                tenantId,
                itemId: { in: itemIds },
                locationId: { in: locationIds },
                movementType: 'RECEIVE',
                createdAt: { gte: periodStart, lt: periodEnd },
            },
            _sum: { qtyIn: true, totalValue: true },
        }),
    ]);

    const breakageMap = {};
    for (const row of breakageRaw) {
        breakageMap[row.itemId] = { qty: Number(row._sum.qtyOut || 0), value: Number(row._sum.totalValue || 0) };
    }

    const grnMap = {};
    for (const row of grnRaw) {
        grnMap[row.itemId] = { qty: Number(row._sum.qtyIn || 0), value: Number(row._sum.totalValue || 0) };
    }

    // 5.5 Get Active Get Passes per item/location
    const activePasses = await prisma.getPassLine.groupBy({
        by: ['itemId', 'locationId'],
        where: {
            getPass: {
                tenantId,
                status: { in: ['OUT', 'PARTIALLY_RETURNED'] }
            },
            status: { in: ['OUT', 'PARTIALLY_RETURNED'] },
            itemId: { in: itemIds },
            locationId: { in: locationIds }
        },
        _sum: { qty: true, qtyReturned: true }
    });

    const getPassMap = {}; // itemId -> locationId -> outstanding qty
    for (const row of activePasses) {
        if (!getPassMap[row.itemId]) getPassMap[row.itemId] = {};
        const outstanding = Number(row._sum.qty || 0) - Number(row._sum.qtyReturned || 0);
        getPassMap[row.itemId][row.locationId] = outstanding;
    }

    // 6. Get PHYSICAL COUNT — latest POSTED session per location, then aggregate
    //    We get one session per location so that all locations are covered fairly.
    const physicalCountMap = {}; // itemId -> totalCountedQty (across all matching locations)

    const latestSessionsRaw = await Promise.all(
        locationIds.map(lid =>
            prisma.stockCountSession.findFirst({
                where: { tenantId, locationId: lid, status: 'POSTED' },
                orderBy: { postedAt: 'desc' },
                select: { id: true },
            })
        )
    );
    const sessionIds = latestSessionsRaw.filter(Boolean).map(s => s.id);

    if (sessionIds.length > 0) {
        const countLines = await prisma.stockCountLine.findMany({
            where: {
                sessionId: { in: sessionIds },
                itemId: { in: itemIds },
                countedQty: { not: null },
            },
            select: { itemId: true, countedQty: true },
        });
        for (const cl of countLines) {
            physicalCountMap[cl.itemId] = (physicalCountMap[cl.itemId] || 0) + Number(cl.countedQty);
        }
    }


    const reportItems = items.map((item, idx) => {
        const unitPrice = Number(item.unitPrice || 0);

        // Qty per location
        const locationQtys = {};
        let totalQty = 0;
        let totalOutOnPass = 0;
        for (const loc of locations) {
            const qty = balanceMap[item.id]?.[loc.id] || 0;
            const passQty = getPassMap[item.id]?.[loc.id] || 0;
            locationQtys[loc.id] = qty;
            totalQty += qty;
            totalOutOnPass += passQty;
        }

        const breakages = breakageMap[item.id]?.qty || 0;
        const breakageValue = breakageMap[item.id]?.value || 0;
        const grnQty = grnMap[item.id]?.qty || 0;
        const grnValue = grnMap[item.id]?.value || 0;
        const openStock = openingMap[item.id] || 0;
        const openValue = openStock * unitPrice;
        const theorQty = openStock + grnQty - breakages - totalOutOnPass;
        const theorValue = theorQty * unitPrice;
        const closeStock = totalQty;
        const totalValue = totalQty * unitPrice;
        const varianceQty = closeStock - openStock;
        const varianceValue = varianceQty * unitPrice;

        return {
            sr: idx + 1,
            itemId: item.id,
            name: item.name,
            barcode: item.barcode,
            imageUrl: item.imageUrl,
            supplier: item.supplier?.name || '',
            category: item.category?.name || '',
            unitPrice,
            locationQtys,
            breakages,
            breakageValue,
            totalOutOnPass,
            grnQty,
            grnValue,
            theorQty,
            theorValue,
            totalQty,
            totalValue,
            openStock,
            openValue,
            varianceQty,
            varianceValue,
            closeStock,
            physicalCount: physicalCountMap[item.id] ?? null,
            physicalVariance: physicalCountMap[item.id] != null ? (physicalCountMap[item.id] - totalQty) : null,
        };
    });

    // 7. Summary totals
    const totals = {
        totalQty: 0, totalValue: 0, openStock: 0, openValue: 0,
        breakages: 0, breakageValue: 0,
        grnQty: 0, grnValue: 0,
        theorQty: 0, theorValue: 0,
        varianceQty: 0, varianceValue: 0, closeStock: 0,
        locationTotals: {},
    };
    for (const loc of locations) totals.locationTotals[loc.id] = 0;

    for (const row of reportItems) {
        totals.totalQty += row.totalQty;
        totals.totalValue += row.totalValue;
        totals.openStock += row.openStock;
        totals.openValue += row.openValue;
        totals.breakages += row.breakages;
        totals.breakageValue += row.breakageValue;
        totals.grnQty += row.grnQty;
        totals.grnValue += row.grnValue;
        totals.theorQty += row.theorQty;
        totals.theorValue += row.theorValue;
        totals.varianceQty += row.varianceQty;
        totals.varianceValue += row.varianceValue;
        totals.closeStock += row.closeStock;
        for (const loc of locations) {
            totals.locationTotals[loc.id] += row.locationQtys[loc.id] || 0;
        }
    }

    return { items: reportItems, locations, totals, year: periodYear };
};

// \u2500\u2500 EXPORT TO EXCEL (ExcelJS \u2014 styled to match the screen) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const exportToExcel = async (tenantId, params, blindCount = false) => {
    const ExcelJS = require('exceljs');
    const report = await getStockReport(tenantId, params);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'OSE Inventory System';
    wb.created = new Date();
    const ws = wb.addWorksheet('Stock Report', {
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 }
    });

    // Color palette (ARGB) matching on-screen table
    const C = {
        HEADER: 'FF1F2937',  // gray-800
        LOC: 'FF1E3A8A',  // blue-900
        BREAK: 'FF7F1D1D',  // red-900
        TOTAL: 'FF14532D',  // green-900
        OPEN: 'FF78350F',  // amber-800
        VAR: 'FF7C2D12',  // orange-800
        CLOSE: 'FF4C1D95',  // purple-900
        PHYS: 'FFB45309',  // amber-700
        WHITE: 'FFFFFFFF',
        // data
        LOC_D: 'FFEFF6FF',
        BREAK_D: 'FFFEF2F2',
        TOTAL_D: 'FFF0FDF4',
        OPEN_D: 'FFFEFCE8',
        VAR_POS: 'FFF0FDF4', VAR_NEG: 'FFFEF2F2',
        CLOSE_D: 'FFF5F3FF',
        PHYS_D: 'FFFEF3C7',
        ODD: 'FFF9FAFB',
        // text
        TEXT_RED: 'FFB91C1C', TEXT_GRN: 'FF15803D', TEXT_GRAY: 'FF9CA3AF',
    };

    const mkHdr = (bg) => ({
        font: { bold: true, size: 9, color: { argb: C.WHITE } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } },
        alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
        border: { bottom: { style: 'thin', color: { argb: C.WHITE } } }
    });

    // ── Column definitions (ordered sequentially) ─────────────────────────
    const colDefs = [
        { key: 'sr', label: 'SR', width: 5, bg: C.HEADER, align: 'center' },
        { key: 'supplier', label: 'Supplier', width: 20, bg: C.HEADER, align: 'left' },
        { key: 'category', label: 'Category', width: 18, bg: C.HEADER, align: 'left' },
        { key: 'item', label: 'Item Description', width: 32, bg: C.HEADER, align: 'left' },
        { key: 'barcode', label: 'Barcode', width: 16, bg: C.HEADER, align: 'center' },
        { key: 'price', label: 'Unit Price', width: 11, bg: C.HEADER, align: 'right', numFmt: '#,##0.00' },
        
        { key: 'openStock', label: `Open ${report.year}`, width: 12, bg: C.OPEN, align: 'center', dataBg: C.OPEN_D, numFmt: '#,##0' },
        { key: 'openValue', label: 'Open Value', width: 13, bg: C.OPEN, align: 'right', dataBg: C.OPEN_D, numFmt: '#,##0.00' },
        
        { key: 'grnQty', label: 'GRN Qty', width: 11, bg: C.LOC, align: 'center', dataBg: C.LOC_D, numFmt: '#,##0' },
        { key: 'grnValue', label: 'GRN Value', width: 13, bg: C.LOC, align: 'right', dataBg: C.LOC_D, numFmt: '#,##0.00' },
        { key: 'breakages', label: 'Breakages', width: 11, bg: C.BREAK, align: 'center', dataBg: C.BREAK_D, numFmt: '#,##0' },
        { key: 'gatePass', label: 'Gate Pass', width: 11, bg: C.VAR, align: 'center', dataBg: C.PHYS_D, numFmt: '#,##0' },
        
        { key: 'theorQty', label: 'Theoretical', width: 12, bg: C.CLOSE, align: 'center', dataBg: C.CLOSE_D, numFmt: '#,##0', bold: true },
        { key: 'theorValue', label: 'Theor. Value', width: 14, bg: C.CLOSE, align: 'right', dataBg: C.CLOSE_D, numFmt: '#,##0.00' },
    ];
    
    // Physical locations book stock
    for (const loc of report.locations) {
        colDefs.push({ key: `l_${loc.id}`, label: loc.name, width: 12, bg: C.LOC, align: 'center', dataBg: C.LOC_D, numFmt: '#,##0' });
    }

    // Physical Count columns
    for (const loc of report.locations) {
        colDefs.push({ key: `cnt_${loc.id}`, label: `Count: ${loc.name}`, width: 16, bg: C.PHYS, align: 'center', dataBg: C.PHYS_D, numFmt: '#,##0' });
        colDefs.push({ key: `var_${loc.id}`, label: `Variance: ${loc.name}`, width: 16, bg: C.PHYS, align: 'center', physVar: true, numFmt: '#,##0' });
    }

    colDefs.push(
        { key: 'varQty', label: 'Final Variance', width: 14, bg: C.VAR, align: 'center', variance: true, numFmt: '#,##0' },
        { key: 'closeStock', label: `Close ${report.year}`, width: 12, bg: C.TOTAL, align: 'center', dataBg: C.TOTAL_D, numFmt: '#,##0', bold: true },
    );

    ws.columns = colDefs.map(c => ({ key: c.key, width: c.width }));

    // ── Title row — uses colDefs.length so it always covers ALL columns ───
    ws.mergeCells(1, 1, 1, colDefs.length);
    const titleCell = ws.getCell('A1');
    titleCell.value = `STOCK REPORT ${report.year}${blindCount ? ' — BLIND COUNT SHEET' : ''}`;
    titleCell.style = { font: { bold: true, size: 14, color: { argb: C.WHITE } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: C.HEADER } }, alignment: { horizontal: 'center', vertical: 'middle' } };
    ws.getRow(1).height = 32;
    ws.addRow([]); // spacer row 2

    // Header row (row 3)
    const hRow = ws.getRow(3);
    hRow.height = 36;
    colDefs.forEach((c, i) => {
        const cell = hRow.getCell(i + 1);
        cell.value = c.label;
        cell.style = { ...mkHdr(c.bg), alignment: { horizontal: c.align, vertical: 'middle', wrapText: true } };
    });
    ws.views = [{ state: 'frozen', ySplit: 3 }];

    // Data rows
    report.items.forEach((item, idx) => {
        const isOdd = idx % 2 === 1;
        const rowData = {
            sr: item.sr, supplier: item.supplier, category: item.category,
            item: item.name, barcode: item.barcode || '', price: item.unitPrice,
        };
        rowData.openStock = blindCount ? null : item.openStock;
        rowData.openValue = blindCount ? null : item.openValue;
        
        rowData.grnQty = blindCount ? null : item.grnQty;
        rowData.grnValue = blindCount ? null : item.grnValue;
        rowData.breakages = blindCount ? null : item.breakages;
        rowData.gatePass = blindCount ? null : item.totalOutOnPass;
        
        rowData.theorQty = blindCount ? null : item.theorQty;
        rowData.theorValue = blindCount ? null : item.theorValue;

        for (const loc of report.locations) rowData[`l_${loc.id}`] = blindCount ? null : (item.locationQtys[loc.id] || 0);

        rowData.varQty = item.varianceQty;
        rowData.closeStock = item.closeStock;

        for (const loc of report.locations) {
            rowData[`cnt_${loc.id}`] = null;  // Always blank - staff fills during physical count


            // Variance = Counted - System Book
            const lBook = item.locationQtys[loc.id] || 0;
            // NOTE: before upload, locationQtys is actually the book qty.
            // After upload, locationQtys is the counted qty and book qty is lost unless we are using savedReport details.
            // But for exports, we don't have the original book qty easily available if they counted. 
            // We'll leave Variance blank on export unless they've uploaded, but typically exports are for the blank sheet anyway.
            rowData[`var_${loc.id}`] = null;
        }

        const row = ws.addRow(rowData);
        row.height = 20;

        colDefs.forEach((cd, ci) => {
            const cell = row.getCell(ci + 1);
            const val = rowData[cd.key];
            let bg = cd.dataBg || (isOdd ? C.ODD : 'FFFFFFFF');
            let fgColor = { argb: 'FF111827' };
            let bold = cd.bold || false;

            if (cd.variance && typeof val === 'number') {
                bg = val < 0 ? C.VAR_NEG : val > 0 ? C.VAR_POS : C.PHYS_D;
                fgColor = { argb: val < 0 ? C.TEXT_RED : val > 0 ? C.TEXT_GRN : C.TEXT_GRAY };
                bold = true;
            }
            if (cd.physVar && typeof val === 'number') {
                bg = val < 0 ? C.VAR_NEG : val > 0 ? C.VAR_POS : C.PHYS_D;
                fgColor = { argb: val < 0 ? C.TEXT_RED : val > 0 ? C.TEXT_GRN : C.TEXT_GRAY };
                bold = true;
            }

            cell.style = {
                font: { size: 9, bold, color: fgColor },
                fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } },
                alignment: { horizontal: cd.align, vertical: 'middle' },
                border: { bottom: { style: 'dotted', color: { argb: 'FFE5E7EB' } } },
            };
            // Re-assign value after style (ExcelJS may reset it during style application)
            if (val !== null && val !== undefined) cell.value = val;
            if (cd.numFmt && val !== null && val !== undefined && val !== '') cell.numFmt = cd.numFmt;
        });
    });

    // Totals row
    const totData = {
        sr: '', supplier: '', category: '', item: 'TOTALS', barcode: '', price: '',
    };
    totData.openStock = report.totals.openStock;
    totData.openValue = report.totals.openValue;
    totData.grnQty = report.totals.grnQty;
    totData.grnValue = report.totals.grnValue;
    totData.breakages = report.totals.breakages;
    totData.gatePass = report.items.reduce((acc, curr) => acc + (curr.totalOutOnPass || 0), 0);
    totData.theorQty = report.totals.theorQty;
    totData.theorValue = report.totals.theorValue;

    for (const loc of report.locations) totData[`l_${loc.id}`] = report.totals.locationTotals[loc.id] || 0;
    
    totData.varQty = report.totals.varianceQty;
    totData.closeStock = report.totals.closeStock;
    totData.physCount = report.items.filter(i => i.physicalCount != null).length > 0
        ? report.items.reduce((s, i) => s + (i.physicalCount ?? 0), 0) : null;
    totData.physVar = null;
    if (blindCount) for (const loc of report.locations) totData[`cnt_${loc.id}`] = null;

    const totRow = ws.addRow(totData);
    totRow.height = 24;
    colDefs.forEach((cd, ci) => {
        const cell = totRow.getCell(ci + 1);
        cell.style = {
            font: { bold: true, size: 9, color: { argb: C.WHITE } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: cd.bg } },
            alignment: { horizontal: cd.align, vertical: 'middle' },
        };
        if (cd.numFmt) cell.numFmt = cd.numFmt;
    });

    return wb.xlsx.writeBuffer();
};



// ── UPLOAD COUNTED EXCEL ──────────────────────────────────────────────────────
const uploadCountedExcel = async (filePath, tenantId, departmentId, categoryId, year, userId) => {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    // New ExcelJS export: row1=title, row2=spacer, row3=headers, row4+=data → use range:2
    // Legacy plain-xlsx export: row1=headers → use range:0
    let rows = XLSX.utils.sheet_to_json(ws, { defval: '', range: 2 });
    if (rows.length === 0 || !Object.keys(rows[0] || {}).includes('Item Description')) {
        rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    }


    if (rows.length === 0) throw Object.assign(new Error('No data rows'), { status: 400 });

    // Get locations for this department
    const locations = await prisma.location.findMany({
        where: { tenantId, departmentId, isActive: true },
        select: { id: true, name: true },
    });

    // Look for "Count: <LocationName>" columns
    const countColumns = {};
    const headerRow = rows[0] || {};
    for (const loc of locations) {
        if (`Count: ${loc.name}` in headerRow) {
            countColumns[`Count: ${loc.name}`] = loc.id;
        } else if (loc.name in headerRow) {
            // Fallback for older legacy templates
            countColumns[loc.name] = loc.id;
        }
    }

    // Find items by name — filter out summary rows (TOTALS, empty, etc.)
    const SKIP_NAMES = new Set(['totals', 'total', '']);
    const itemNames = rows
        .map(r => String(r['Item Description'] || '').trim())
        .filter(name => name && !SKIP_NAMES.has(name.toLowerCase()));

    const items = await prisma.item.findMany({
        where: { tenantId, name: { in: itemNames } },
        select: { id: true, name: true },
    });
    const itemMap = new Map(items.map(i => [i.name.toLowerCase(), i.id]));

    let updated = 0;
    let skipped = 0;
    const errors = [];

    const countedMap = {}; // itemId -> locationId -> countedQty

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const itemName = String(row['Item Description'] || '').trim();

        // Skip summary/empty rows
        if (!itemName || SKIP_NAMES.has(itemName.toLowerCase())) continue;

        const itemId = itemMap.get(itemName.toLowerCase());

        if (!itemId) {
            skipped++;
            errors.push({ row: i + 2, error: `Item '${itemName}' not found` });
            continue;
        }


        if (!countedMap[itemId]) countedMap[itemId] = {};

        for (const [colName, locationId] of Object.entries(countColumns)) {
            const val = row[colName];
            if (val === '' || val === undefined || val === null) continue;

            const countedQty = Number(val);
            if (isNaN(countedQty) || countedQty < 0) {
                errors.push({ row: i + 2, error: `Invalid qty '${val}' for ${colName}` });
                continue;
            }

            countedMap[itemId][locationId] = countedQty;
            updated++;
        }
    }

    // Generate the base report to act as a preview
    const report = await getStockReport(tenantId, { departmentId, categoryId, year });

    const totals = {
        totalQty: 0, totalValue: 0, openStock: 0, openValue: 0,
        breakages: 0, varianceQty: 0, varianceValue: 0, closeStock: 0,
        locationTotals: {},
    };
    for (const loc of report.locations) totals.locationTotals[loc.id] = 0;

    for (const row of report.items) {
        if (countedMap[row.itemId]) {
            if (row.bookCloseQty == null) row.bookCloseQty = row.closeStock;
            if (!row.bookLocationQtys) row.bookLocationQtys = { ...row.locationQtys };

            for (const loc of report.locations) {
                if (countedMap[row.itemId][loc.id] !== undefined) {
                    row.locationQtys[loc.id] = countedMap[row.itemId][loc.id];
                }
            }
            // Recalculate row totals based on new counted locationQtys
            row.totalQty = report.locations.reduce((sum, loc) => sum + (row.locationQtys[loc.id] || 0), 0);
            row.varianceQty = row.totalQty - row.openStock;
            row.physVarianceQty = row.totalQty - row.bookCloseQty;
            row.totalValue = row.totalQty * row.unitPrice;
            row.varianceValue = row.varianceQty * row.unitPrice;
            row.physVarianceValue = row.physVarianceQty * row.unitPrice;
        } else {
            row.physVarianceQty = 0;
            row.physVarianceValue = 0;
        }

        totals.totalQty += row.totalQty;
        totals.totalValue += row.totalValue;
        totals.openStock += row.openStock;
        totals.openValue += row.openValue;
        totals.breakages += row.breakages;
        totals.varianceQty += row.varianceQty;
        totals.varianceValue += row.varianceValue;
        totals.physVarianceQty = (totals.physVarianceQty || 0) + Math.abs(row.physVarianceQty);
        totals.physVarianceValue = (totals.physVarianceValue || 0) + Math.abs(row.physVarianceValue);
        totals.closeStock += row.closeStock;
        for (const loc of report.locations) {
            totals.locationTotals[loc.id] += (row.locationQtys[loc.id] || 0);
        }
    }

    report.totals = totals;

    return { updated, skipped, errors, totalRows: rows.length, report };
};

// ── SAVE STOCK REPORT ─────────────────────────────────────────────────────────
const saveStockReport = async (tenantId, userId, data) => {
    const { departmentId, locationId, notes, reportData } = data;

    if (!locationId) throw Object.assign(new Error('Location is required to save a report.'), { status: 400 });

    // Ensure strict backend recalculation of physical variances before saving
    let recalculatedTotalVarValue = 0;
    reportData.items = reportData.items.map(item => {
        const bookCloseQty = item.bookCloseQty != null ? item.bookCloseQty : (item.closeStock || 0);

        let countedTotalQty = 0;
        for (const loc of reportData.locations) {
            const val = item.locationQtys[loc.id];
            countedTotalQty += val != null ? Number(val) : 0;
        }

        const varianceQty = countedTotalQty - bookCloseQty;
        const varianceValue = varianceQty * (item.unitPrice || 0);

        recalculatedTotalVarValue += Math.abs(varianceValue);

        return {
            ...item,
            totalQty: countedTotalQty,
            totalValue: countedTotalQty * (item.unitPrice || 0),
            physVarianceQty: varianceQty,
            physVarianceValue: varianceValue,
            bookCloseQty
        };
    });

    // Auto-generate report number
    const yearMonth = new Date().toISOString().slice(2, 7).replace('-', '');
    const prefix = `SRPT-${yearMonth}-`;
    const lastDoc = await prisma.savedStockReport.findFirst({
        where: { tenantId, reportNo: { startsWith: prefix } },
        orderBy: { reportNo: 'desc' },
    });
    const seq = lastDoc ? (parseInt(lastDoc.reportNo.split('-').pop()) + 1) : 1;
    const reportNo = `${prefix}${seq.toString().padStart(4, '0')}`;

    return prisma.$transaction(async (tx) => {
        const report = await tx.savedStockReport.create({
            data: {
                tenantId,
                reportNo,
                locationId,
                notes,
                createdBy: userId,
                totalValue: recalculatedTotalVarValue,
                lines: {
                    create: reportData.items.map(item => ({
                        itemId: item.itemId,
                        openingQty: item.openStock || 0,
                        openingValue: item.openValue || 0,
                        // inwardQty = the physically counted / uploaded qty
                        inwardQty: item.totalQty || 0,
                        inwardValue: item.totalValue || 0,
                        // outwardQty = physical variance to adjust book
                        outwardQty: item.physVarianceQty || 0,
                        outwardValue: item.physVarianceValue || 0,
                        // Get Pass out (informational)
                        outOnPassQty: item.totalOutOnPass || 0,
                        // GRN / Receipts and Breakages (informational)
                        grnQty: item.grnQty || 0,
                        grnValue: item.grnValue || 0,
                        breakages: item.breakages || 0,
                        // closingQty = TRUE BOOK QTY from the system (before upload override)
                        // item.bookCloseQty is set by frontend when upload was done; fallback to closeStock
                        closingQty: item.bookCloseQty != null ? item.bookCloseQty : (item.closeStock || 0),
                        closingValue: 0,

                        locationQtys: {
                            create: reportData.locations.map(loc => {
                                const book = item.bookLocationQtys?.[loc.id] ?? 0;
                                const counted = item.locationQtys?.[loc.id];
                                // if counted is undefined, they didn't count this location specifically
                                return {
                                    locationId: loc.id,
                                    bookQty: book,
                                    countedQty: counted != null ? counted : null,
                                    varianceQty: counted != null ? (counted - book) : 0
                                };
                            })
                        }
                    }))
                }
            },
            include: { lines: true }
        });

        // Setup Approval Request for Stock Report
        await tx.approvalRequest.create({
            data: {
                tenantId,
                requestType: 'STOCK_REPORT',
                status: 'PENDING',
                documentId: null, // we use relation
                SavedStockReport: { connect: { id: report.id } },
                currentStep: 0,
                totalSteps: 1, // 1 step approval (e.g. Finance)
                createdBy: userId,
                steps: {
                    create: [
                        { stepNumber: 1, requiredRole: connectRole('FINANCE_MANAGER'), status: 'PENDING' }
                    ]
                }
            }
        });

        return report;
    });
};

const submitStockReport = async (id, tenantId, userId) => {
    const report = await prisma.savedStockReport.findFirst({
        where: { id, tenantId },
        include: { approvalRequest: true }
    });
    if (!report) throw Object.assign(new Error('Saved report not found'), { status: 404 });
    if (report.status !== 'DRAFT') throw Object.assign(new Error('Report must be DRAFT to submit'), { status: 400 });

    const updated = await prisma.savedStockReport.update({
        where: { id },
        data: { status: 'PENDING_APPROVAL', updatedAt: new Date() }
    });

    if (report.approvalRequest) {
        await prisma.approvalRequest.update({
            where: { id: report.approvalRequest.id },
            data: { currentStep: 1 }
        });

        // Email Finance Manager
        try {
            const approvers = await prisma.tenantMember.findMany({
                where: { tenantId, role: { code: 'FINANCE_MANAGER' }, isActive: true, user: { isActive: true } },
                select: { user: { select: { email: true } } }
            });
            const submitter = await prisma.user.findUnique({ where: { id: userId } });

            const pseudoApproval = {
                type: 'STOCK_REPORT',
                createdAt: updated.createdAt,
                notes: `Stock Report No: ${updated.reportNo}`
            };
            for (const app of approvers) {
                await emailService.sendApprovalPendingNotification(pseudoApproval, submitter, app.user.email);
            }
        } catch (err) {
            console.error("Failed to send Stock Report approval:", err);
        }
    }

    return updated;
};

const processApproval = async (id, tenantId, userId, action, reason) => {
    const report = await prisma.savedStockReport.findFirst({
        where: { id, tenantId }
    });

    if (!report) throw Object.assign(new Error('Report not found'), { statusCode: 404 });
    if (report.status !== 'PENDING_APPROVAL') {
        throw Object.assign(new Error('Report is not pending approval'), { statusCode: 400 });
    }

    // Query the approval request via the FK stored on SavedStockReport
    const approvalRequest = report.approvalRequestId
        ? await prisma.approvalRequest.findUnique({ where: { id: report.approvalRequestId } })
        : null;

    const postingService = require('./posting.service');

    return prisma.$transaction(async (tx) => {
        if (action === 'APPROVE') {
            if (approvalRequest) {
                await tx.approvalRequest.update({
                    where: { id: approvalRequest.id },
                    data: { status: 'APPROVED' }
                });
            }
            // postStockReport will transition status to POSTED
        } else if (action === 'REJECT') {
            if (approvalRequest) {
                await tx.approvalRequest.update({
                    where: { id: approvalRequest.id },
                    data: { status: 'REJECTED', notes: reason }
                });
            }
            await tx.savedStockReport.update({
                where: { id },
                data: { status: 'REJECTED', notes: reason ? `${report.notes ? report.notes + '\\n\\n' : ''}Rejected Reason: ${reason}` : `${report.notes ? report.notes + '\\n\\n' : ''}Rejected` }
            });
            return { message: 'Report rejected' };
        }
    }).then(async (res) => {
        if (action === 'APPROVE') {
            // Post to ledger outside the first transaction
            await postingService.postStockReport(id, tenantId, userId);

            // Send email notification
            try {
                const submitter = await prisma.user.findUnique({ where: { id: report.createdBy } });
                const approver = await prisma.user.findUnique({ where: { id: userId } });
                await emailService.sendApprovalResultNotification({
                    type: 'STOCK_REPORT',
                    createdAt: report.createdAt,
                    notes: `Stock Report No: ${report.reportNo}`
                }, 'APPROVED', submitter.email, null, approver);
            } catch (err) {
                console.error('Email notification failed:', err);
            }

            return { message: 'Report approved and posted successfully' };
        }
        return res;
    });
};

const getSavedReports = async (tenantId) => {
    return prisma.savedStockReport.findMany({
        where: { tenantId },
        include: {
            location: { select: { name: true } },
            createdByUser: { select: { firstName: true, lastName: true } }
        },
        orderBy: { createdAt: 'desc' }
    });
};

const getSavedReportById = async (id, tenantId) => {
    return prisma.savedStockReport.findFirst({
        where: { id, tenantId },
        include: {
            lines: {
                include: {
                    item: { select: { name: true, barcode: true } },
                    locationQtys: {
                        include: { location: { select: { name: true } } }
                    }
                }
            },
            location: { select: { name: true } },
            createdByUser: { select: { firstName: true, lastName: true } },
            approvalRequest: {
                include: {
                    steps: {
                        orderBy: { actedAt: 'asc' },
                        include: { actedByUser: { select: { firstName: true, lastName: true } } }
                    }
                }
            }
        }
    });
};

module.exports = {
    getStockReport,
    exportToExcel,
    uploadCountedExcel,
    saveStockReport,
    submitStockReport,
    processApproval,
    getSavedReports,
    getSavedReportById
};
