const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

/**
 * Helper to get the starting date and ending date ISO strings.
 * Validates that dates are within a reasonable range.
 */
const getDateRange = (startDate, endDate) => {
    const start = startDate ? new Date(startDate) : new Date(0);
    const end = endDate ? new Date(endDate) : new Date();

    // Validate dates are not NaN and year is in a sane range
    if (isNaN(start.getTime()) || start.getFullYear() > 9999) {
        throw Object.assign(new Error('Invalid start date. Please provide a valid date.'), { status: 400 });
    }
    if (isNaN(end.getTime()) || end.getFullYear() > 9999) {
        throw Object.assign(new Error('Invalid end date. Please provide a valid date.'), { status: 400 });
    }

    // Set end to end of day
    end.setHours(23, 59, 59, 999);
    return { start, end };
};

/**
 * Generate Report and Save to History
 */
const generateReport = async (tenantId, { reportType, departmentIds, startDate, endDate, generatedBy, categoryId }) => {
    if (!['SUMMARY', 'DETAIL', 'BREAKAGE', 'OMC', 'TRANSFERS', 'AGING'].includes(reportType)) {
        throw new Error('Invalid report type');
    }

    const { start, end } = getDateRange(startDate, endDate);
    let data = {};
    let reportName = `${reportType} Report`;

    // Fetch selected departments
    const deptIds = Array.isArray(departmentIds) && departmentIds.length > 0 ? departmentIds : null;
    let deptNames = 'All Departments';
    if (deptIds) {
        const depts = await prisma.department.findMany({ where: { id: { in: deptIds } } });
        deptNames = depts.map(d => d.name).join(', ');
        reportName = `${reportType} Report — ${deptNames}`;
    }

    // Fetch category to link locations to its explicit mapping
    let categoryObj = null;
    let linkedLocIds = null;
    if (categoryId) {
        categoryObj = await prisma.category.findUnique({ 
            where: { id: categoryId },
            include: { locationCategories: true }
        });
        if (categoryObj) {
            linkedLocIds = categoryObj.locationCategories.map(lc => lc.locationId);
        }
    }

    // Determine the locations for the selected departments
    let locationWhere = { tenantId };
    
    // If category is selected, locations must be restricted
    if (categoryObj) {
        if (linkedLocIds && linkedLocIds.length > 0) {
            locationWhere.id = { in: linkedLocIds };
            // Intersect with deptIds if specific departments were chosen
            if (deptIds) locationWhere.departmentId = { in: deptIds };
        } else if (categoryObj.departmentId) {
            // Fallback to the category's department if no explicit explicit links exist
            locationWhere.departmentId = categoryObj.departmentId;
        }
    } else if (deptIds) {
        locationWhere.departmentId = { in: deptIds };
    }
    const locations = await prisma.location.findMany({ where: locationWhere });
    const locationIds = locations.map(l => l.id);

    // Common Item Include for Item details
    const itemInclude = {
        category: { select: { name: true } },
    };

    switch (reportType) {
        case 'SUMMARY':
        case 'DETAIL':
            data = await generateVarianceReport(tenantId, locationIds, start, end, reportType === 'SUMMARY', categoryId);
            break;
        case 'BREAKAGE':
            data = await generateBreakageReport(tenantId, locationIds, start, end, categoryId);
            break;
        case 'OMC':
            data = await generateOMCReport(tenantId, locationIds, start, end, categoryId);
            break;
        case 'TRANSFERS':
            data = await generateTransfersReport(tenantId, locationIds, start, end, categoryId);
            break;
        case 'AGING':
            data = await generateAgingReport(tenantId, locationIds, categoryId);
            break;
    }

    // Save to Database
    const generatedReport = await prisma.generatedReport.create({
        data: {
            tenantId,
            reportType,
            reportName,
            departmentId: (deptIds && deptIds.length === 1) ? deptIds[0] : null,
            startDate: start,
            endDate: end,
            data: { ...data, deptNames },
            generatedBy
        }
    });

    return generatedReport;
};

/**
 * 1. Summary & 2. Detail Report:
 * Opening, Closing, Physical Count, Variance
 */
const generateVarianceReport = async (tenantId, locationIds, start, end, isSummary, categoryId) => {
    // 1. Fetch Item Master & Current Closing Balances
    const stockBalances = await prisma.stockBalance.findMany({
        where: { 
            tenantId, 
            locationId: { in: locationIds },
            ...(categoryId ? { item: { categoryId } } : {})
        },
        include: { item: { include: { category: true, supplier: true } } }
    });

    const locations = await prisma.location.findMany({ where: { tenantId, id: { in: locationIds } } });

    // Build Item map and identify all unique items
    const itemMap = {};
    stockBalances.forEach(sb => {
        if (!itemMap[sb.itemId]) {
            itemMap[sb.itemId] = { ...sb.item, balances: {} };
        }
        itemMap[sb.itemId].balances[sb.locationId] = { qty: Number(sb.qtyOnHand || 0), value: Number(sb.totalValue || 0) };
    });

    // 2. Fetch Period Movements (In / Out / Tfr)
    const periodLedger = await prisma.inventoryLedger.groupBy({
        by: ['itemId', 'locationId', 'movementType'],
        where: { tenantId, locationId: { in: locationIds }, createdAt: { gte: start, lte: end } },
        _sum: { qtyIn: true, qtyOut: true, totalValue: true }
    });

    // Bucket movements per item
    const moves = {}; // itemId -> { inQty, inVal, outQty, outVal, brkQty, brkVal, adjQty, obQty, obVal }
    for (const p of periodLedger) {
        if (!moves[p.itemId]) {
            moves[p.itemId] = { inQty: 0, inVal: 0, outQty: 0, outVal: 0, brkQty: 0, brkVal: 0, adjQty: 0, obQty: 0, obVal: 0 };
        }
        const m = moves[p.itemId];
        const qIn = Number(p._sum.qtyIn || 0);
        const qOut = Number(p._sum.qtyOut || 0);
        const val = Number(p._sum.totalValue || 0);

        if (p.movementType === 'RECEIVE' || p.movementType === 'RETURN' || p.movementType === 'TRANSFER_IN') {
            m.inQty += qIn; m.inVal += val;
        } else if (p.movementType === 'BREAKAGE') {
            m.brkQty += qOut; m.brkVal += val;
        } else if (p.movementType === 'ISSUE' || p.movementType === 'TRANSFER_OUT') {
            m.outQty += qOut; m.outVal += val;
        } else if (p.movementType === 'OPENING_BALANCE') {
            m.obQty += qIn; m.obVal += val;
        } else if (p.movementType === 'ADJUSTMENT' || p.movementType === 'COUNT_ADJUSTMENT') {
            m.adjQty += (qIn - qOut);
        }
    }

    // 3. Fetch Active Gate Passes
    const activePasses = await prisma.getPassLine.groupBy({
        by: ['itemId'],
        where: {
            getPass: { tenantId, status: { in: ['OUT', 'PARTIALLY_RETURNED'] } },
            locationId: { in: locationIds }
        },
        _sum: { qty: true, qtyReturned: true }
    });
    const gatePassMap = {};
    for (const ap of activePasses) {
        gatePassMap[ap.itemId] = Number(ap._sum.qty || 0) - Number(ap._sum.qtyReturned || 0);
    }

    // 4. Physical Count
    const countSessions = await prisma.stockCountSession.findMany({
        where: { tenantId, locationId: { in: locationIds }, countDate: { gte: start, lte: end }, status: 'POSTED' },
        orderBy: { countDate: 'asc' },
        include: { lines: true }
    });
    const physicalCounts = {};
    for (const session of countSessions) {
        for (const line of session.lines) {
            if (line.countedQty !== null) {
                if (!physicalCounts[line.itemId]) physicalCounts[line.itemId] = 0;
                physicalCounts[line.itemId] += Number(line.countedQty);
            }
        }
    }

    // 5. Combine and resolve Opening -> Theoretical
    let rows = [];
    for (const itemId of Object.keys(itemMap)) {
        const item = itemMap[itemId];
        const unitPrice = Number(item.unitPrice || 0);
        
        let closeQty = 0;
        let closeVal = 0;
        const locationQtys = {};

        // Aggregate across selected locations
        for (const locId of locationIds) {
            const locBal = item.balances[locId];
            const q = locBal ? locBal.qty : 0;
            locationQtys[locId] = q;
            closeQty += q;
        }
        
        // Calculate total closing value dynamically using unitPrice
        closeVal = closeQty * unitPrice;

        const mov = moves[itemId] || { inQty: 0, inVal: 0, outQty: 0, outVal: 0, brkQty: 0, brkVal: 0, adjQty: 0, obQty: 0, obVal: 0 };
        
        // Reverse Engineer Opening mathematically (Closing - Inwards + Outwards - Adjustments - OpeningBalances)
        const totalPeriodIn = mov.inQty;
        const totalPeriodOut = mov.outQty + mov.brkQty;
        const trueOpenQty = closeQty - totalPeriodIn + totalPeriodOut - mov.adjQty - mov.obQty;
        
        // The Report expects Opening Balance to include any imported OPENING_BALANCE ledgers
        const reportOpenQty = trueOpenQty + mov.obQty;
        const reportOpenVal = reportOpenQty * unitPrice;

        const gatePassQty = gatePassMap[itemId] || 0;
        
        // Theoretical = Report Opening + Inwards - Outwards (Issues) - Breakage - GatePass
        const theorQty = reportOpenQty + mov.inQty - mov.outQty - mov.brkQty - gatePassQty;
        const theorVal = theorQty * unitPrice;

        const physQty = physicalCounts[itemId] !== undefined ? physicalCounts[itemId] : closeQty; // fallback to close
        const varianceQty = physQty - theorQty;
        const varianceVal = varianceQty * unitPrice;

        rows.push({
            itemId: item.id,
            category: item.category?.name || 'Uncategorized',
            itemCode: item.barcode || 'N/A',
            itemName: item.name || 'Unknown Item',
            supplier: item.supplier?.name || '',
            imageUrl: item.imageUrl || null,
            unitPrice: unitPrice,

            openingQty: Number(reportOpenQty.toFixed(4)),
            openingValue: Number(reportOpenVal.toFixed(2)),
            
            inwardQty: Number(mov.inQty.toFixed(4)),
            inwardValue: Number((mov.inQty * unitPrice).toFixed(2)),
            
            outwardQty: Number(mov.outQty.toFixed(4)),
            outwardValue: Number((mov.outQty * unitPrice).toFixed(2)),

            breakageQty: Number(mov.brkQty.toFixed(4)),
            breakageValue: Number((mov.brkQty * unitPrice).toFixed(2)),

            gatePassQty: Number(gatePassQty.toFixed(4)),
            gatePassValue: Number((gatePassQty * unitPrice).toFixed(2)),

            theoreticalQty: Number(theorQty.toFixed(4)),
            theoreticalValue: Number(theorVal.toFixed(2)),

            physicalQty: Number(physQty.toFixed(4)),
            varianceQty: Number(varianceQty.toFixed(4)),
            varianceValue: Number(varianceVal.toFixed(2)),

            closingQty: Number(closeQty.toFixed(4)),
            closingValue: Number(closeVal.toFixed(2)),
            
            locationQtys // Pass the complete map!
        });
    }

    if (isSummary) {
        // Group by Category for Summary Report
        const summary = {};
        rows.forEach(r => {
            const cat = r.category;
            if (!summary[cat]) {
                summary[cat] = {
                    category: cat, openingQty: 0, openingValue: 0, closingQty: 0, closingValue: 0,
                    physicalQty: 0, varianceQty: 0, varianceValue: 0
                };
            }
            summary[cat].openingQty += r.openingQty;
            summary[cat].openingValue += r.openingValue;
            summary[cat].closingQty += r.closingQty;
            summary[cat].closingValue += r.closingValue;
            summary[cat].physicalQty += r.physicalQty;
            summary[cat].varianceQty += r.varianceQty;
            summary[cat].varianceValue += r.varianceValue;
        });
        return {
            rows: Object.values(summary).map(s => ({
                category: s.category,
                openingQty: Number(s.openingQty.toFixed(2)),
                openingValue: Number(s.openingValue.toFixed(2)),
                closingQty: Number(s.closingQty.toFixed(2)),
                closingValue: Number(s.closingValue.toFixed(2)),
                physicalQty: Number(s.physicalQty.toFixed(2)),
                varianceQty: Number(s.varianceQty.toFixed(2)),
                varianceValue: Number(s.varianceValue.toFixed(2))
            }))
        };
    }

    // Make sure we pass the location names to the FE so they can render headers
    const locationList = locations.map(l => ({ id: l.id, name: l.name }));
    
    // Sort rows alphabetically by category then name
    rows.sort((a, b) => a.category.localeCompare(b.category) || a.itemName.localeCompare(b.itemName));

    return { rows, locations: locationList };
};

/**
 * 3. Breakage Report
 */
const generateBreakageReport = async (tenantId, locationIds, start, end, categoryId) => {
    const breakages = await prisma.movementDocument.findMany({
        where: {
            tenantId,
            movementType: 'BREAKAGE',
            status: 'POSTED',
            documentDate: { gte: start, lte: end },
            sourceLocationId: locationIds.length > 0 ? { in: locationIds } : undefined
        },
        include: {
            lines: {
                include: { item: { include: { category: true } } }
            },
            createdByUser: true
        },
        orderBy: { documentDate: 'asc' }
    });

    // Get location and department names separately
    const locationMap = {};
    const usedLocationIds = [...new Set(breakages.map(b => b.sourceLocationId).filter(Boolean))];

    if (usedLocationIds.length > 0) {
        const locs = await prisma.location.findMany({ 
            where: { id: { in: usedLocationIds } },
            include: { department: true }
        });
        locs.forEach(l => {
            locationMap[l.id] = {
                name: l.name,
                departmentName: l.department?.name || 'N/A'
            };
        });
    }

    let rows = [];
    breakages.forEach(doc => {
        doc.lines.forEach(line => {
            if (categoryId && line.item.categoryId !== categoryId) return;
            rows.push({
                date: doc.documentDate.toISOString().split('T')[0],
                documentNo: doc.documentNo,
                department: locationMap[doc.sourceLocationId]?.departmentName || 'N/A',
                location: locationMap[doc.sourceLocationId]?.name || doc.sourceLocationId || 'N/A',
                createdBy: doc.createdByUser ? `${doc.createdByUser.firstName} ${doc.createdByUser.lastName}` : 'N/A',
                category: line.item.category?.name || 'Uncategorized',
                itemCode: line.item.barcode || '',
                itemName: line.item.name,
                qty: Number(line.qtyInBaseUnit) || 0,
                value: Number(line.totalValue) || (Number(line.qtyInBaseUnit) * Number(line.item.unitPrice || 0)),
                reason: doc.reason || ''
            });
        });
    });

    return { rows };
};

/**
 * 4. OMC (Opening – Movement – Closing) — v2
 *
 * Opening Logic (per item + location):
 *   1. Find latest PeriodSnapshot where period closedAt < startDate
 *   2. If no snapshot → sum ledger entries before startDate (from after last close if any)
 *
 * Movement Breakdown within period (per item + location):
 *   OB (Initial Load) = OPENING_BALANCE               ← Separate bucket, not merged into In
 *   In                = RECEIVE + RETURN               ← Operational receipts only
 *   TransferIn        = TRANSFER_IN
 *   Out               = ISSUE + BREAKAGE
 *   TransferOut       = TRANSFER_OUT
 *   Adjustment        = ADJUSTMENT + COUNT_ADJUSTMENT (signed)
 *
 * Closing = Opening + OB + In + TransferIn - Out - TransferOut ± Adjustment
 */
const generateOMCReport = async (tenantId, locationIds, start, end, categoryId) => {
    const locFilter = locationIds.length > 0 ? { in: locationIds } : undefined;

    // ── Step 1: Best PeriodSnapshot before startDate ──────────────────────────
    const bestClose = await prisma.periodClose.findFirst({
        where: { tenantId, status: 'CLOSED', closedAt: { lt: start } },
        orderBy: { closedAt: 'desc' },
    });

    const snapshotMap = {};
    if (bestClose) {
        const snapshots = await prisma.periodSnapshot.findMany({
            where: { periodCloseId: bestClose.id, ...(locFilter ? { locationId: locFilter } : {}) },
        });
        for (const s of snapshots) {
            snapshotMap[`${s.itemId}_${s.locationId}`] = {
                qty: Number(s.closingQty),
                wac: Number(s.wacUnitCost),
                value: Number(s.closingValue),
            };
        }
    }

    // ── Step 2: Ledger-fallback opening (entries after last close, before start) ──
    const fallbackWhere = {
        tenantId,
        locationId: locFilter,
        createdAt: {
            gte: bestClose?.closedAt ?? new Date(0),
            lt: start,
        },
    };
    const ledgerBefore = await prisma.inventoryLedger.groupBy({
        by: ['itemId', 'locationId'],
        where: fallbackWhere,
        _sum: { qtyIn: true, qtyOut: true, totalValue: true },
    });

    // ── Step 3: Period movements (raw, to separate by type) ──────────────────
    const periodEntries = await prisma.inventoryLedger.findMany({
        where: { tenantId, locationId: locFilter, createdAt: { gte: start, lte: end } },
        select: { itemId: true, locationId: true, movementType: true, qtyIn: true, qtyOut: true, totalValue: true, unitCost: true },
    });

    // ── Step 4: Build key set ─────────────────────────────────────────────────
    const keySet = new Set();
    Object.keys(snapshotMap).forEach(k => keySet.add(k));
    ledgerBefore.forEach(l => keySet.add(`${l.itemId}_${l.locationId}`));
    periodEntries.forEach(l => keySet.add(`${l.itemId}_${l.locationId}`));

    // ── Step 5: Load item + location details ──────────────────────────────────
    const allItemIds = [...new Set([...keySet].map(k => k.split('_')[0]))];
    const allLocIds  = [...new Set([...keySet].map(k => k.split('_')[1]))];
    const [items, locs] = await Promise.all([
        prisma.item.findMany({ where: { id: { in: allItemIds }, ...(categoryId ? { categoryId } : {}) }, include: { category: true } }),
        prisma.location.findMany({ where: { id: { in: allLocIds } }, include: { department: true } }),
    ]);
    const itemMap = {};
    items.forEach(i => (itemMap[i.id] = i));
    const locMap = {};
    locs.forEach(l => (locMap[l.id] = l));

    // ── Step 6: Aggregate period movements per key ────────────────────────────
    // OPENING_BALANCE goes into its own obQty/obValue bucket — NOT merged into In.
    const moveMap = {};
    for (const e of periodEntries) {
        const key = `${e.itemId}_${e.locationId}`;
        if (!moveMap[key]) moveMap[key] = {
            obQty: 0, obValue: 0,          // Initial Load (OPENING_BALANCE only)
            inQty: 0, inValue: 0,           // Operational In (RECEIVE + RETURN)
            outQty: 0, outValue: 0,
            tfrInQty: 0, tfrOutQty: 0,
            adjQty: 0, adjValue: 0,
        };
        const m = moveMap[key];
        const qIn  = Number(e.qtyIn  || 0);
        const qOut = Number(e.qtyOut || 0);
        const val  = Number(e.totalValue || 0);

        switch (e.movementType) {
            case 'OPENING_BALANCE':
                // ← Separate bucket: Initial Load
                m.obQty += qIn; m.obValue += val; break;
            case 'RECEIVE': case 'RETURN':
                // ← Operational receipts only
                m.inQty += qIn; m.inValue += val; break;
            case 'TRANSFER_IN':
                m.inQty += qIn; m.inValue += val; m.tfrInQty += qIn; break;
            case 'ISSUE': case 'BREAKAGE':
                m.outQty += qOut; m.outValue += val; break;
            case 'TRANSFER_OUT':
                m.outQty += qOut; m.outValue += val; m.tfrOutQty += qOut; break;
            case 'ADJUSTMENT': case 'COUNT_ADJUSTMENT':
                m.adjQty += (qIn - qOut);
                m.adjValue += (qIn > 0 ? val : -val); break;
        }
    }

    // ── Step 7: Build rows ────────────────────────────────────────────────────
    const rows = [];
    for (const key of keySet) {
        const [itemId, locationId] = key.split('_');

        if (categoryId && !itemMap[itemId]) continue;

        // Opening: snapshot preferred
        let openQty = 0, openWac = 0, openValue = 0;
        if (snapshotMap[key]) {
            ({ qty: openQty, wac: openWac, value: openValue } = snapshotMap[key]);
        } else {
            const lb = ledgerBefore.find(l => l.itemId === itemId && l.locationId === locationId);
            if (lb) {
                openQty   = Number(lb._sum.qtyIn || 0) - Number(lb._sum.qtyOut || 0);
                openValue = Number(lb._sum.totalValue || 0);
                openWac   = openQty > 0 ? openValue / openQty : 0;
            }
        }

        const m = moveMap[key] || { obQty: 0, obValue: 0, inQty: 0, inValue: 0, outQty: 0, outValue: 0, tfrInQty: 0, tfrOutQty: 0, adjQty: 0, adjValue: 0 };

        // Closing = Opening + OB + In + TfrIn - Out - TfrOut ± Adj
        const closeQty   = openQty + m.obQty + m.inQty - m.outQty + m.adjQty;

        // Closing WAC: recalculate weighted average including OB and In
        const totalInValue = openValue + m.obValue + m.inValue;
        const totalInQty   = openQty + m.obQty + m.inQty;
        const closeWac = totalInQty > 0 ? totalInValue / totalInQty : openWac;
        const closeValue = closeQty * closeWac;

        // Skip rows with zero activity
        if (openQty === 0 && m.obQty === 0 && m.inQty === 0 && m.outQty === 0 && m.adjQty === 0) continue;

        rows.push({
            department:   locMap[locationId]?.department?.name || '',
            location:     locMap[locationId]?.name || '',
            category:     itemMap[itemId]?.category?.name || '',
            itemCode:     itemMap[itemId]?.barcode || '',
            itemName:     itemMap[itemId]?.name || 'Unknown',
            openingQty:   Number(openQty.toFixed(4)),
            openingValue: Number(openValue.toFixed(2)),
            obQty:        Number(m.obQty.toFixed(4)),         // Initial Load (OB)
            obValue:      Number(m.obValue.toFixed(2)),
            inQty:        Number(m.inQty.toFixed(4)),          // Operational In
            inValue:      Number(m.inValue.toFixed(2)),
            outQty:       Number(m.outQty.toFixed(4)),
            outValue:     Number(m.outValue.toFixed(2)),
            tfrInQty:     Number(m.tfrInQty.toFixed(4)),
            tfrOutQty:    Number(m.tfrOutQty.toFixed(4)),
            adjQty:       Number(m.adjQty.toFixed(4)),
            adjValue:     Number(m.adjValue.toFixed(2)),
            closingQty:   Number(closeQty.toFixed(4)),
            closingValue: Number(closeValue.toFixed(2)),
            unitCost:     Number(closeWac.toFixed(4)),
        });
    }

    rows.sort((a, b) =>
        a.department.localeCompare(b.department) ||
        a.location.localeCompare(b.location) ||
        a.category.localeCompare(b.category) ||
        a.itemName.localeCompare(b.itemName)
    );

    return {
        rows,
        snapshotUsed: bestClose ? { year: bestClose.year, month: bestClose.month, closedAt: bestClose.closedAt } : null,
    };
};


/**
 * 5. Transfers Report
 */
const generateTransfersReport = async (tenantId, locationIds, start, end, categoryId) => {
    // Determine if the selected locations were source OR dest
    const transfers = await prisma.storeTransfer.findMany({
        where: {
            tenantId,
            status: { in: ['RECEIVED', 'CLOSED'] },
            transferDate: { gte: start, lte: end },
            OR: [
                { sourceLocationId: { in: locationIds } },
                { destLocationId: { in: locationIds } }
            ]
        },
        include: {
            sourceLocation: true,
            destLocation: true,
            requestedByUser: true,
            lines: { include: { item: true } }
        },
        orderBy: { transferDate: 'asc' }
    });

    let rows = [];
    transfers.forEach(doc => {
        doc.lines.forEach(line => {
            if (categoryId && line.item.categoryId !== categoryId) return;
            const isOut = locationIds.includes(doc.sourceLocationId);
            const isIn = locationIds.includes(doc.destLocationId);

            let type = 'Internal';
            if (isOut && !isIn) type = 'Transfer Out';
            if (!isOut && isIn) type = 'Transfer In';

            rows.push({
                date: doc.transferDate.toISOString().split('T')[0],
                documentNo: doc.transferNo,
                type,
                source: doc.sourceLocation.name,
                destination: doc.destLocation.name,
                itemName: line.item.name,
                qty: Number(line.receivedQty || line.requestedQty),
                value: Number(line.totalValue),
                requestedBy: doc.requestedByUser?.firstName + ' ' + doc.requestedByUser?.lastName
            });
        });
    });

    return { rows };
};

/**
 * 6. Aging Report
 */
const generateAgingReport = async (tenantId, locationIds, categoryId) => {
    const balances = await prisma.stockBalance.findMany({
        where: { 
            tenantId, 
            locationId: { in: locationIds }, 
            qtyOnHand: { gt: 0 },
            ...(categoryId ? { item: { categoryId } } : {})
        },
        include: { location: true, item: { include: { category: true } } }
    });

    let rows = [];

    // Find the last receive date for each item/location
    const now = new Date();
    for (const b of balances) {
        // Last GRN / receive ledger
        const lastReceive = await prisma.inventoryLedger.findFirst({
            where: { tenantId, itemId: b.itemId, locationId: b.locationId, qtyIn: { gt: 0 } },
            orderBy: { createdAt: 'desc' }
        });

        const lastDate = lastReceive ? lastReceive.createdAt : null;
        let diffDays = 0;
        if (lastDate) {
            diffDays = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
        } else {
            // If never received but has balance, fallback to opening balance concept
            diffDays = 999;
        }

        let bucket = '0-30 Days';
        if (diffDays > 30 && diffDays <= 60) bucket = '31-60 Days';
        else if (diffDays > 60 && diffDays <= 90) bucket = '61-90 Days';
        else if (diffDays > 90) bucket = '90+ Days';

        rows.push({
            location: b.location.name,
            category: b.item.category?.name || '',
            itemName: b.item.name,
            qtyOnHand: Number(b.qtyOnHand),
            lastReceiveDate: lastDate ? lastDate.toISOString().split('T')[0] : 'Never',
            daysOld: diffDays,
            bucket
        });
    }

    // Sort by days old descending
    rows.sort((a, b) => b.daysOld - a.daysOld);

    return { rows };
};


/**
 * Get Report History
 */
const getHistory = async (tenantId, reportType) => {
    return await prisma.generatedReport.findMany({
        where: { tenantId, ...(reportType && { reportType }) },
        orderBy: { createdAt: 'desc' },
        include: { department: true, generatedByUser: true }
    });
};

/**
 * Get Specific Report
 */
const getReportById = async (tenantId, reportId) => {
    const report = await prisma.generatedReport.findFirst({
        where: { id: reportId, tenantId },
        include: { department: true, generatedByUser: true }
    });
    if (!report) throw new Error('Report not found');
    return report;
};

// ─── Export Logic ───

const getColumnsForReport = (reportType) => {
    switch (reportType) {
        case 'SUMMARY': return [
            { key: 'category', label: 'Category', width: 25 }, { key: 'openingQty', label: 'Opening Qty', width: 15 },
            { key: 'openingValue', label: 'Op Value', width: 15 }, { key: 'closingQty', label: 'Closing Qty', width: 15 },
            { key: 'closingValue', label: 'Cl Value', width: 15 }, { key: 'physicalQty', label: 'Phys Count', width: 15 },
            { key: 'varianceQty', label: 'Var Qty', width: 15 }, { key: 'varianceValue', label: 'Var Value', width: 15 }
        ];
        case 'DETAIL': return [
            { key: 'category', label: 'Category', width: 15 }, { key: 'itemCode', label: 'Code', width: 15 }, 
            { key: 'itemName', label: 'Item Name', width: 25 }, { key: 'supplier', label: 'Supplier', width: 20 },
            { key: 'openingQty', label: 'Open Qty', width: 10 }, { key: 'openingValue', label: 'Open Val', width: 12 },
            { key: 'inwardQty', label: 'GRN Qty', width: 10 }, { key: 'inwardValue', label: 'GRN Val', width: 12 },
            { key: 'breakageQty', label: 'Brk Qty', width: 10 }, { key: 'breakageValue', label: 'Brk Val', width: 12 },
            { key: 'gatePassQty', label: 'Pass Qty', width: 10 }, { key: 'gatePassValue', label: 'Pass Val', width: 12 },
            { key: 'theoreticalQty', label: 'Book Qty', width: 10 }, { key: 'theoreticalValue', label: 'Book Val', width: 12 },
            { key: 'physicalQty', label: 'Phys Qty', width: 10 }, { key: 'varianceQty', label: 'Var Qty', width: 10 }, 
            { key: 'varianceValue', label: 'Var Val', width: 12 }, { key: 'closingQty', label: 'Close Qty', width: 10 },
            { key: 'closingValue', label: 'Close Val', width: 12 }
        ];
        case 'BREAKAGE': return [
            { key: 'date', label: 'Date', width: 12 }, { key: 'documentNo', label: 'Doc No', width: 18 },
            { key: 'location', label: 'Location', width: 20 }, { key: 'itemName', label: 'Item', width: 30 },
            { key: 'qty', label: 'Qty', width: 10 }, { key: 'value', label: 'Value', width: 15 },
            { key: 'reason', label: 'Reason', width: 25 }, { key: 'createdBy', label: 'Created By', width: 20 }
        ];
        case 'OMC': return [
            { key: 'department',   label: 'Department',  width: 18 },
            { key: 'location',     label: 'Location',    width: 20 },
            { key: 'category',     label: 'Category',    width: 18 },
            { key: 'itemCode',     label: 'Code',        width: 14 },
            { key: 'itemName',     label: 'Item Name',   width: 28 },
            { key: 'openingQty',   label: 'Open Qty',    width: 12 },
            { key: 'openingValue', label: 'Open Value',  width: 12 },
            { key: 'inQty',        label: 'In (+)',      width: 10 },
            { key: 'tfrInQty',     label: 'Tfr In',     width: 10 },
            { key: 'outQty',       label: 'Out (-)',     width: 10 },
            { key: 'tfrOutQty',    label: 'Tfr Out',    width: 10 },
            { key: 'adjQty',       label: 'Adj Qty',    width: 10 },
            { key: 'adjValue',     label: 'Adj Value',  width: 12 },
            { key: 'closingQty',   label: 'Close Qty',  width: 12 },
            { key: 'closingValue', label: 'Close Value',width: 12 },
            { key: 'unitCost',     label: 'WAC',        width: 12 },
        ];
        case 'TRANSFERS': return [
            { key: 'date', label: 'Date', width: 12 }, { key: 'documentNo', label: 'Trf No', width: 18 },
            { key: 'type', label: 'Type', width: 15 }, { key: 'source', label: 'Source', width: 20 },
            { key: 'destination', label: 'Destination', width: 20 }, { key: 'itemName', label: 'Item', width: 30 },
            { key: 'qty', label: 'Qty', width: 10 }, { key: 'requestedBy', label: 'Requested By', width: 20 }
        ];
        case 'AGING': return [
            { key: 'location', label: 'Location', width: 20 }, { key: 'category', label: 'Category', width: 20 },
            { key: 'itemName', label: 'Item', width: 30 }, { key: 'qtyOnHand', label: 'Qty', width: 10 },
            { key: 'lastReceiveDate', label: 'Last Rx', width: 15 }, { key: 'daysOld', label: 'Days Old', width: 10 },
            { key: 'bucket', label: 'Bucket', width: 15 }
        ];
        case 'VALUATION': return [
            { key: 'department',  label: 'Department',  width: 18 },
            { key: 'location',    label: 'Location',    width: 20 },
            { key: 'category',    label: 'Category',    width: 18 },
            { key: 'itemCode',    label: 'Code',        width: 14 },
            { key: 'itemName',    label: 'Item Name',   width: 28 },
            { key: 'qtyOnHand',   label: 'Qty On Hand', width: 12 },
            { key: 'unitCost',    label: 'WAC',         width: 12 },
            { key: 'totalValue',  label: 'Total Value', width: 14 },
        ];
        default: return [];
    }
};

const exportExcel = async (tenantId, reportId) => {
    const report = await getReportById(tenantId, reportId);
    const columns = getColumnsForReport(report.reportType);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'OSE Inventory';
    const ws = wb.addWorksheet(report.reportType);

    // Title rows
    ws.addRow([report.reportName]);
    ws.addRow([`Period: ${report.startDate ? new Date(report.startDate).toLocaleDateString() : 'N/A'} - ${report.endDate ? new Date(report.endDate).toLocaleDateString() : 'N/A'}`]);
    ws.addRow([]); // Blank

    // Header
    ws.columns = columns.map(c => ({ header: c.label, key: c.key, width: c.width }));

    // Fill data
    const rows = report.data.rows || [];
    rows.forEach(r => ws.addRow(r));

    // Styling
    const headerRow = ws.getRow(4);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };

    return wb;
};

const exportPdf = async (tenantId, reportId) => {
    return new Promise(async (resolve, reject) => {
        try {
            const report = await getReportById(tenantId, reportId);
            const columns = getColumnsForReport(report.reportType);
            const rows = report.data.rows || [];

            const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
            let buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                let pdfData = Buffer.concat(buffers);
                resolve(pdfData);
            });

            // Header
            doc.fontSize(18).text(report.reportName, { align: 'center' });
            doc.fontSize(10).fillColor('gray').text(`Period: ${report.startDate ? new Date(report.startDate).toLocaleDateString() : 'N/A'} - ${report.endDate ? new Date(report.endDate).toLocaleDateString() : 'N/A'}`, { align: 'center' });
            doc.moveDown(2);

            // Very simple Table drawing manually or using simple text columns
            let y = doc.y;
            let startX = 30;

            // Draw headers
            doc.fontSize(9).fillColor('black');
            let xOffset = startX;
            columns.forEach(col => {
                doc.text(col.label, xOffset, y, { width: col.width * 5, align: 'left' });
                xOffset += col.width * 5 + 10;
            });

            y += 15;
            doc.moveTo(startX, y).lineTo(800, y).stroke();
            y += 5;

            // Draw rows
            doc.fontSize(8).fillColor('#333');
            for (let i = 0; i < rows.length; i++) {
                if (y > 550) {
                    doc.addPage({ layout: 'landscape' });
                    y = 30;
                }
                const r = rows[i];
                xOffset = startX;

                columns.forEach(col => {
                    const val = r[col.key];
                    const valStr = (val !== null && val !== undefined) ? String(val) : '';
                    doc.text(valStr, xOffset, y, { width: col.width * 5, align: 'left', lineBreak: false, ellipsis: true });
                    xOffset += col.width * 5 + 10;
                });
                y += 15;
            }

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
};

/**
 * 7. Valuation Report — As-of-Date
 *
 * Answers: "What was the inventory value on a specific date?"
 *
 * Algorithm (per item + location):
 *   1. Find best PeriodSnapshot where closedAt <= asOfDate
 *   2. Start qty/WAC from snapshot
 *   3. Add ledger entries from (snapshot closedAt) to asOfDate
 *   4. Recalculate WAC incrementally for receives
 *   5. Adjust qty for issues, transfers, adjustments
 *
 * @param {string}  tenantId
 * @param {Date}    asOfDate        — the point-in-time date
 * @param {Object}  filters         — { locationIds, departmentIds, categoryId }
 */
const generateValuationReport = async (tenantId, asOfDate, filters = {}) => {
    const { locationIds = [], departmentIds = [], categoryId } = filters;

    // ── Resolve locations ────────────────────────────────────────────────────
    const locWhere = { tenantId, isActive: true };
    if (locationIds.length > 0)   locWhere.id = { in: locationIds };
    if (departmentIds.length > 0) locWhere.departmentId = { in: departmentIds };
    const locations = await prisma.location.findMany({ where: locWhere, include: { department: true } });
    const resolvedLocIds = locations.map(l => l.id);
    const locMap = {};
    locations.forEach(l => (locMap[l.id] = l));

    if (resolvedLocIds.length === 0) return { rows: [], asOfDate, totalValue: 0 };

    // ── Resolve items (optional category filter) ─────────────────────────────
    const itemWhere = { tenantId, isActive: true };
    if (categoryId) itemWhere.categoryId = categoryId;
    const items = await prisma.item.findMany({ where: itemWhere, include: { category: true } });
    const itemMap = {};
    items.forEach(i => (itemMap[i.id] = i));
    const resolvedItemIds = items.map(i => i.id);

    // ── Step 1: Best PeriodSnapshot on or before asOfDate ───────────────────
    const asOf = new Date(asOfDate);
    asOf.setHours(23, 59, 59, 999);

    const bestClose = await prisma.periodClose.findFirst({
        where: { tenantId, status: 'CLOSED', closedAt: { lte: asOf } },
        orderBy: { closedAt: 'desc' },
    });

    // Snapshot map: key = `itemId_locationId` → { qty, wac, value }
    const balanceMap = {};

    if (bestClose) {
        const snapshots = await prisma.periodSnapshot.findMany({
            where: {
                periodCloseId: bestClose.id,
                locationId: { in: resolvedLocIds },
                itemId: { in: resolvedItemIds },
            },
        });
        for (const s of snapshots) {
            balanceMap[`${s.itemId}_${s.locationId}`] = {
                qty: Number(s.closingQty),
                wac: Number(s.wacUnitCost),
                value: Number(s.closingValue),
            };
        }
    }

    // ── Step 2: Replay Ledger from snapshot point → asOfDate ────────────────
    const ledgerEntries = await prisma.inventoryLedger.findMany({
        where: {
            tenantId,
            locationId: { in: resolvedLocIds },
            itemId: { in: resolvedItemIds },
            createdAt: {
                gte: bestClose?.closedAt ?? new Date(0),
                lte: asOf,
            },
        },
        orderBy: { createdAt: 'asc' }, // chronological order matters for WAC
        select: { itemId: true, locationId: true, movementType: true, qtyIn: true, qtyOut: true, unitCost: true, totalValue: true },
    });

    // Replay each ledger entry to update running balance + WAC
    for (const e of ledgerEntries) {
        const key = `${e.itemId}_${e.locationId}`;
        if (!balanceMap[key]) balanceMap[key] = { qty: 0, wac: 0, value: 0 };
        const b = balanceMap[key];
        const qIn  = Number(e.qtyIn  || 0);
        const qOut = Number(e.qtyOut || 0);
        const val  = Number(e.totalValue || 0);
        const unitCost = Number(e.unitCost || 0);

        switch (e.movementType) {
            case 'RECEIVE':
            case 'OPENING_BALANCE':
            case 'RETURN':
            case 'TRANSFER_IN': {
                // Recalculate WAC on receipt
                const newTotalQty = b.qty + qIn;
                const newTotalVal = b.value + val;
                b.wac   = newTotalQty > 0 ? newTotalVal / newTotalQty : (unitCost || b.wac);
                b.qty   = newTotalQty;
                b.value = newTotalVal;
                break;
            }
            case 'ISSUE':
            case 'BREAKAGE':
            case 'TRANSFER_OUT':
                b.qty   -= qOut;
                b.value  = b.qty * b.wac;  // WAC unchanged on outbound
                break;
            case 'ADJUSTMENT':
            case 'COUNT_ADJUSTMENT': {
                const net = qIn - qOut;
                b.qty  += net;
                b.value = b.qty * b.wac;   // WAC unchanged on adjustment
                break;
            }
        }
        // Guard against negative qty drift
        if (b.qty < 0) { b.qty = 0; b.value = 0; }
    }

    // ── Step 3: Build report rows ────────────────────────────────────────────
    const rows = [];
    let grandTotal = 0;

    for (const [key, bal] of Object.entries(balanceMap)) {
        if (bal.qty <= 0 && bal.value <= 0) continue;
        const [itemId, locationId] = key.split('_');
        const item = itemMap[itemId];
        const loc  = locMap[locationId];
        if (!item || !loc) continue;

        const totalValue = Number((bal.qty * bal.wac).toFixed(2));
        grandTotal += totalValue;

        rows.push({
            department:  loc.department?.name || '',
            location:    loc.name,
            category:    item.category?.name || '',
            itemCode:    item.barcode || '',
            itemName:    item.name,
            qtyOnHand:   Number(bal.qty.toFixed(4)),
            unitCost:    Number(bal.wac.toFixed(4)),
            totalValue,
        });
    }

    rows.sort((a, b) =>
        a.department.localeCompare(b.department) ||
        a.location.localeCompare(b.location) ||
        a.category.localeCompare(b.category) ||
        a.itemName.localeCompare(b.itemName)
    );

    return {
        rows,
        asOfDate: asOf.toISOString(),
        totalValue: Number(grandTotal.toFixed(2)),
        snapshotUsed: bestClose ? { year: bestClose.year, month: bestClose.month, closedAt: bestClose.closedAt } : null,
    };
};

module.exports = {
    generateReport,
    generateValuationReport,
    getHistory,
    getReportById,
    exportExcel,
    exportPdf
};
