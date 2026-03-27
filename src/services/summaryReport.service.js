const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// OSE SUMMARY INVENTORY REPORT
// Columns: Opening | GRN (Purchases) | Breakage | Theoretical | Physical Count
//           | Count Variance | Closing Balance
//
// Opening      = PeriodClose snapshot (immutable) → fallback: ledger before month
// GRN          = InventoryLedger movementType='RECEIVE'   in period
// Breakage     = InventoryLedger movementType='BREAKAGE'  in period
// Theoretical  = Opening + GRN − Breakage − GatePass (Out)
// Variance     = InventoryLedger movementType='COUNT_ADJUSTMENT' in period
// Closing      = Theoretical + Variance
// Physical     = Same as Closing
//
// All filtered to DEPARTMENT-OWNED LOCATIONS only (matches Stock Report logic)
// ─────────────────────────────────────────────────────────────────────────────

const getSummaryReport = async (tenantId, { startDate, endDate, departmentIds, categoryId }) => {
    let start, end;
    if (startDate && endDate) {
        start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
    } else {
        // Fallback to current month if no dates provided
        const m = new Date().getMonth();
        const y = new Date().getFullYear();
        start = new Date(y, m, 1, 0, 0, 0);
        end = new Date(y, m + 1, 0, 23, 59, 59, 999);
    }

    const empty = { rows: [], totals: null, period: { startDate: start.toISOString(), endDate: end.toISOString() } };

    // ── 1. ITEMS ──────────────────────────────────────────────────────────────
    const itemWhere = { tenantId, isActive: true };
    if (departmentIds && departmentIds.length > 0) itemWhere.departmentId = { in: departmentIds };
    if (categoryId) itemWhere.categoryId = categoryId;

    const items = await prisma.item.findMany({
        where: itemWhere,
        select: {
            id: true,
            department: { select: { id: true, name: true } },
            category: { select: { id: true, name: true } },
        },
    });

    if (!items.length) return empty;

    const itemIds = items.map(i => i.id);
    const itemMeta = {};
    for (const it of items) {
        itemMeta[it.id] = {
            deptId: it.department?.id || 'none',
            deptName: it.department?.name || 'No Department',
            catName: it.category?.name || 'Uncategorized',
        };
    }

    // ── 2. DEPARTMENT → LOCATION IDs (same scope as Stock Report) ─────────────
    const deptIds = [...new Set(Object.values(itemMeta).map(m => m.deptId).filter(d => d !== 'none'))];
    const deptLocRows = await prisma.location.findMany({
        where: { tenantId, departmentId: { in: deptIds }, isActive: true },
        select: { id: true, departmentId: true },
    });
    const deptLocMap = {};
    for (const l of deptLocRows) {
        if (!deptLocMap[l.departmentId]) deptLocMap[l.departmentId] = new Set();
        deptLocMap[l.departmentId].add(l.id);
    }
    const allLocationIds = deptLocRows.map(l => l.id);
    if (!allLocationIds.length) return empty;

    // Helper: item's location set
    const itemLocSet = (itemId) => deptLocMap[itemMeta[itemId]?.deptId] || new Set();

    // ── 3. OPENING BALANCE ────────────────────────────────────────────────────
    // Priority 1: PeriodClose snapshot from previous month-close or year-close
    // Priority 2: Ledger sum before startDate + OPENING_BALANCE entries

    const openQtyMap = {};   // itemId → qty
    const openValMap = {};   // itemId → value (SAR)
    let usedSnapshot = false;

    // Search order: Dec of prev year (annual) → prev month close
    // Search order: look for the most recent closed period BEFORE the start date
    const prevClose = await prisma.periodClose.findFirst({
        where: {
            tenantId, 
            status: 'CLOSED',
            // It should be something that ended before or exactly when our startDate begins.
            // But since PeriodClose uses `year` and `month`, we can derive it from the `startDate`
            OR: [
                { year: start.getFullYear(), month: start.getMonth() }, // 0 is January, so if start is Feb (1), it looks for periodClose of month=1 (which is Jan!) Wait, PeriodClose month is 1-12.
                // Actually, if start is e.g. March 1 (month JS 2), we want Feb (month 2). 
                { year: start.getFullYear(), month: start.getMonth() === 0 ? 12 : start.getMonth() },
                { year: start.getFullYear() - 1, month: 12 },
                { year: start.getFullYear() - 1, month: null }
            ],
        },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    if (prevClose) {
        const snaps = await prisma.periodSnapshot.findMany({
            where: {
                periodCloseId: prevClose.id,
                itemId: { in: itemIds },
                locationId: { in: allLocationIds },
            },
            select: { itemId: true, locationId: true, closingQty: true },
        });
        for (const s of snaps) {
            if (!itemLocSet(s.itemId).has(s.locationId)) continue;
            openQtyMap[s.itemId] = (openQtyMap[s.itemId] || 0) + Number(s.closingQty);
        }
        usedSnapshot = true;
    }

    // Always compute opening value from ledger (accurate historical cost)
    const openingWhere = {
        tenantId,
        itemId: { in: itemIds },
        locationId: { in: allLocationIds },
        OR: [
            { createdAt: { lt: start } },
            { movementType: 'OPENING_BALANCE' },
        ],
    };

    const [openIn, openOut] = await Promise.all([
        prisma.inventoryLedger.groupBy({
            by: ['itemId'],
            where: { ...openingWhere, qtyIn: { gt: 0 } },
            _sum: { qtyIn: true, totalValue: true },
        }),
        prisma.inventoryLedger.groupBy({
            by: ['itemId'],
            where: { ...openingWhere, qtyOut: { gt: 0 } },
            _sum: { qtyOut: true, totalValue: true },
        }),
    ]);

    for (const r of openIn) {
        openValMap[r.itemId] = (openValMap[r.itemId] || 0) + Number(r._sum.totalValue || 0);
        // If no snapshot, also use ledger qty
        if (!usedSnapshot) {
            openQtyMap[r.itemId] = (openQtyMap[r.itemId] || 0) + Number(r._sum.qtyIn || 0);
        }
    }
    for (const r of openOut) {
        openValMap[r.itemId] = (openValMap[r.itemId] || 0) - Number(r._sum.totalValue || 0);
        if (!usedSnapshot) {
            openQtyMap[r.itemId] = (openQtyMap[r.itemId] || 0) - Number(r._sum.qtyOut || 0);
        }
    }

    // ── 4. GRN (Purchases) in period ─────────────────────────────────────────
    const periodWhere = {
        tenantId,
        itemId: { in: itemIds },
        locationId: { in: allLocationIds },
        createdAt: { gte: start, lte: end },
    };

    const [grnIn, breakageOut, activePasses, countAdjIn, countAdjOut] = await Promise.all([
        prisma.inventoryLedger.groupBy({
            by: ['itemId'],
            where: { ...periodWhere, movementType: 'RECEIVE' },
            _sum: { qtyIn: true, totalValue: true },
        }),
        prisma.inventoryLedger.groupBy({
            by: ['itemId'],
            where: { ...periodWhere, movementType: 'BREAKAGE' },
            _sum: { qtyOut: true, totalValue: true },
        }),
        prisma.getPassLine.groupBy({
            by: ['itemId'],
            where: {
                getPass: { tenantId, status: { in: ['OUT', 'PARTIALLY_RETURNED'] } },
                status: { in: ['OUT', 'PARTIALLY_RETURNED'] },
                itemId: { in: itemIds },
                locationId: { in: allLocationIds },
            },
            _sum: { qty: true, qtyReturned: true },
        }),
        prisma.inventoryLedger.groupBy({
            by: ['itemId'],
            where: { ...periodWhere, movementType: 'COUNT_ADJUSTMENT', qtyIn: { gt: 0 } },
            _sum: { qtyIn: true, totalValue: true },
        }),
        prisma.inventoryLedger.groupBy({
            by: ['itemId'],
            where: { ...periodWhere, movementType: 'COUNT_ADJUSTMENT', qtyOut: { gt: 0 } },
            _sum: { qtyOut: true, totalValue: true },
        }),
    ]);

    const grnMap = {};  // itemId → { qty, value }
    const breakageMap = {}; // itemId → { qty, value }
    const passMap = {}; // itemId → { qty }
    const varMap = {}; // itemId -> { qty, value } // Variance adjustments

    for (const r of grnIn) {
        grnMap[r.itemId] = { qty: Number(r._sum.qtyIn || 0), value: Number(r._sum.totalValue || 0) };
    }
    for (const r of breakageOut) {
        breakageMap[r.itemId] = { qty: Number(r._sum.qtyOut || 0), value: Number(r._sum.totalValue || 0) };
    }
    for (const r of activePasses) {
        const outstanding = Number(r._sum.qty || 0) - Number(r._sum.qtyReturned || 0);
        passMap[r.itemId] = { qty: outstanding };
    }
    for (const r of countAdjIn) {   // Physical count was HIGHER than book
        if(!varMap[r.itemId]) varMap[r.itemId] = { qty: 0, value: 0 };
        varMap[r.itemId].qty += Number(r._sum.qtyIn || 0);
        varMap[r.itemId].value += Number(r._sum.totalValue || 0);
    }
    for (const r of countAdjOut) {   // Physical count was LOWER than book
        if(!varMap[r.itemId]) varMap[r.itemId] = { qty: 0, value: 0 };
        varMap[r.itemId].qty -= Number(r._sum.qtyOut || 0);
        varMap[r.itemId].value -= Number(r._sum.totalValue || 0);
    }

    const hasPhysical = Object.keys(varMap).length > 0;

    // ── 6. GROUP BY DEPT + CATEGORY ──────────────────────────────────────────
    const groups = {};

    for (const itemId of itemIds) {
        const meta = itemMeta[itemId];
        const key = `${meta.deptId}:::${meta.catName}`;
        const label = `${meta.deptName} - ${meta.catName} Inventory`;

        if (!groups[key]) {
            groups[key] = {
                label, deptName: meta.deptName, catName: meta.catName,
                openQty: 0, openVal: 0,
                grnQty: 0, grnVal: 0,
                brkQty: 0, brkVal: 0,
                passQty: 0, passVal: 0,
                varQty: 0, varVal: 0,
                hasVariance: false,
            };
        }

        const g = groups[key];
        g.openQty += openQtyMap[itemId] || 0;
        g.openVal += openValMap[itemId] || 0;
        g.grnQty += grnMap[itemId]?.qty || 0;
        g.grnVal += grnMap[itemId]?.value || 0;
        g.brkQty += breakageMap[itemId]?.qty || 0;
        g.brkVal += breakageMap[itemId]?.value || 0;
        
        const passQty = passMap[itemId]?.qty || 0;
        // Estimate pass value based on wacUnitCost assuming uniformity, or use average open cost
        const currWac = g.openQty > 0 ? (g.openVal / g.openQty) : 0; // rough approximation for display summary
        g.passQty += passQty;
        g.passVal += passQty * currWac;

        if (varMap[itemId]) {
            g.varQty += varMap[itemId].qty;
            g.varVal += varMap[itemId].value;
            g.hasVariance = true;
        }
    }

    // ── 7. SHAPE ROWS ─────────────────────────────────────────────────────────
    const r2 = n => Math.round(Number(n || 0) * 100) / 100;

    const rows = Object.values(groups)
        .sort((a, b) => a.label.localeCompare(b.label))
        .map(g => {
            const theorQty = r2(g.openQty + g.grnQty - g.brkQty - g.passQty);
            const theorVal = r2(g.openVal + g.grnVal - g.brkVal - g.passVal);
            const varQty = r2(g.varQty);
            const varVal = r2(g.varVal);

            const closeQty = r2(theorQty + varQty);
            const closeVal = r2(theorVal + varVal);

            return {
                label: g.label,
                deptName: g.deptName,
                catName: g.catName,
                openQty: r2(g.openQty), openVal: r2(g.openVal),
                grnQty: r2(g.grnQty), grnVal: r2(g.grnVal),
                brkQty: r2(g.brkQty), brkVal: r2(g.brkVal),
                passQty: r2(g.passQty), passVal: r2(g.passVal),
                theorQty, theorVal,
                varQty: g.hasVariance ? varQty : null,
                varVal: g.hasVariance ? varVal : null,
                physQty: closeQty, 
                physVal: closeVal,
                closeQty, closeVal,
                hasPhys: g.hasVariance,
            };
        });

    // ── 8. TOTALS ─────────────────────────────────────────────────────────────
    const totals = rows.reduce((acc, r) => ({
        openQty: acc.openQty + r.openQty, openVal: acc.openVal + r.openVal,
        grnQty: acc.grnQty + r.grnQty, grnVal: acc.grnVal + r.grnVal,
        brkQty: acc.brkQty + r.brkQty, brkVal: acc.brkVal + r.brkVal,
        passQty: acc.passQty + r.passQty, passVal: acc.passVal + r.passVal,
        theorQty: acc.theorQty + r.theorQty, theorVal: acc.theorVal + r.theorVal,
        varQty: acc.varQty + (r.varQty ?? 0),
        varVal: acc.varVal + (r.varVal ?? 0),
        physQty: acc.physQty + r.physQty,
        physVal: acc.physVal + r.physVal,
        closeQty: acc.closeQty + r.closeQty, closeVal: acc.closeVal + r.closeVal,
    }), {
        openQty: 0, openVal: 0, grnQty: 0, grnVal: 0,
        brkQty: 0, brkVal: 0, passQty: 0, passVal: 0, theorQty: 0, theorVal: 0,
        physQty: 0, physVal: 0, varQty: 0, varVal: 0,
        closeQty: 0, closeVal: 0,
    });

    for (const k of Object.keys(totals)) totals[k] = r2(totals[k]);

    // Variance ratio = varVal / theorVal as %
    totals.varianceRatio = totals.theorVal !== 0
        ? r2((totals.varVal / totals.theorVal) * 100)
        : 0;
    totals.hasPhysical = hasPhysical;

    return { rows, totals, period: { startDate: start.toISOString(), endDate: end.toISOString() }, hasPhysical };
};

module.exports = { getSummaryReport };
