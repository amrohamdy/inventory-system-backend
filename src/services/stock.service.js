const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const ExcelJS = require('exceljs');

// ─── Shared WHERE builder ──────────────────────────────────────────────────────
const buildWhere = (tenantId, query = {}, includeZero = false) => {
    const { locationId, categoryId, departmentId, search, showZero } = query;

    // Build item-level conditions separately then merge into one `item:` block.
    // Using separate spread calls (e.g. { item: {categoryId} }, { item: {departmentId} })
    // would cause the second to silently overwrite the first.
    const itemFilter = {};
    if (categoryId) itemFilter.categoryId = categoryId;
    if (departmentId) itemFilter.departmentId = departmentId;
    if (search) {
        itemFilter.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { barcode: { contains: search, mode: 'insensitive' } },
        ];
    }

    return {
        tenantId,
        ...(!includeZero && showZero !== 'true' && { qtyOnHand: { gt: 0 } }),
        ...(locationId && { locationId }),
        ...(Object.keys(itemFilter).length > 0 && { item: itemFilter }),
    };
};

// ─── GET STOCK BALANCES (paginated) ───────────────────────────────────────────
const getStockBalances = async (tenantId, query = {}) => {
    const { skip = 0, take = 50 } = query;
    const where = buildWhere(tenantId, query);

    const [balances, total] = await Promise.all([
        prisma.stockBalance.findMany({
            where,
            skip: parseInt(skip),
            take: parseInt(take),
            include: {
                item: {
                    select: {
                        id: true, name: true, barcode: true,
                        reorderPoint: true,
                        category: { select: { name: true } },
                        department: { select: { name: true } },
                    },
                },
                location: { select: { id: true, name: true, type: true } },
            },
            orderBy: [{ location: { name: 'asc' } }, { item: { name: 'asc' } }],
        }),
        prisma.stockBalance.count({ where }),
    ]);

    return { balances, total };
};

// ─── GET SUMMARY STATS ────────────────────────────────────────────────────────
const getStockSummary = async (tenantId, query = {}) => {
    const where = buildWhere(tenantId, query, true); // include zero-qty for totals

    const rows = await prisma.stockBalance.findMany({
        where,
        select: {
            qtyOnHand: true,
            wacUnitCost: true,
            item: { select: { reorderPoint: true } },
        },
    });

    let totalQty = 0;
    let totalValue = 0;
    let lowStockCount = 0;
    let zeroStockCount = 0;

    for (const r of rows) {
        const qty = Number(r.qtyOnHand);
        const wac = Number(r.wacUnitCost);
        totalQty += qty;
        totalValue += qty * wac;
        if (qty === 0) zeroStockCount++;
        const reorder = Number(r.item?.reorderPoint || 0);
        if (reorder > 0 && qty < reorder) lowStockCount++;
    }

    return {
        totalItems: rows.length,
        totalQty,
        totalValue,
        lowStockCount,
        zeroStockCount,
    };
};

// ─── EXPORT TO EXCEL ──────────────────────────────────────────────────────────
const exportStockBalances = async (tenantId, query = {}) => {
    const where = buildWhere(tenantId, query);

    const balances = await prisma.stockBalance.findMany({
        where,
        include: {
            item: {
                select: {
                    name: true, barcode: true, reorderPoint: true,
                    category: { select: { name: true } },
                    department: { select: { name: true } },
                },
            },
            location: { select: { name: true } },
        },
        orderBy: [{ location: { name: 'asc' } }, { item: { name: 'asc' } }],
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'OSE Inventory';

    const ws = wb.addWorksheet('Stock Balances');

    // Header styling
    ws.columns = [
        { header: 'Item Name', key: 'name', width: 35 },
        { header: 'Barcode', key: 'barcode', width: 18 },
        { header: 'Department', key: 'dept', width: 20 },
        { header: 'Category', key: 'cat', width: 20 },
        { header: 'Location', key: 'loc', width: 22 },
        { header: 'Qty On Hand', key: 'qty', width: 14 },
        { header: 'Reorder Point', key: 'reorder', width: 14 },
        { header: 'WAC (SAR)', key: 'wac', width: 14 },
        { header: 'Total Value (SAR)', key: 'value', width: 18 },
        { header: 'Status', key: 'status', width: 14 },
    ];

    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    headerRow.alignment = { horizontal: 'center' };

    let grandTotal = 0;

    balances.forEach(b => {
        const qty = Number(b.qtyOnHand);
        const wac = Number(b.wacUnitCost);
        const value = qty * wac;
        const reorder = Number(b.item?.reorderPoint || 0);
        grandTotal += value;

        const isLow = reorder > 0 && qty < reorder;
        const isZero = qty === 0;

        const row = ws.addRow({
            name: b.item?.name || '',
            barcode: b.item?.barcode || '',
            dept: b.item?.department?.name || '',
            cat: b.item?.category?.name || '',
            loc: b.location?.name || '',
            qty,
            reorder: reorder || '',
            wac: wac.toFixed(2),
            value: value.toFixed(2),
            status: isZero ? 'Zero Stock' : isLow ? 'Low Stock' : 'OK',
        });

        // Color rows by status
        if (isZero) {
            row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1F0' } };
        } else if (isLow) {
            row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } };
        }
    });

    // Grand total row
    ws.addRow({});
    const totalRow = ws.addRow({
        name: 'GRAND TOTAL',
        value: grandTotal.toFixed(2),
    });
    totalRow.font = { bold: true };
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };

    // Border on header
    ws.getRow(1).eachCell(cell => {
        cell.border = {
            bottom: { style: 'medium', color: { argb: 'FF1E40AF' } },
        };
    });

    ws.views = [{ state: 'frozen', ySplit: 1 }];

    return wb;
};

// ─── GET ITEM STOCK PROFILE ───────────────────────────────────────────────────
const getItemStockProfile = async (itemId, tenantId) => {
    const item = await prisma.item.findFirst({
        where: { id: itemId, tenantId },
        select: { id: true, name: true, barcode: true, category: { select: { name: true } } },
    });
    if (!item) { const e = new Error('Item not found'); e.statusCode = 404; throw e; }

    const balances = await prisma.stockBalance.findMany({
        where: { itemId, tenantId, qtyOnHand: { gt: 0 } },
        include: { location: { select: { id: true, name: true, type: true } } },
        orderBy: { qtyOnHand: 'desc' },
    });

    const totalQty = balances.reduce((s, b) => s + Number(b.qtyOnHand), 0);
    const totalValue = balances.reduce((s, b) => s + Number(b.qtyOnHand) * Number(b.wacUnitCost), 0);
    const avgWac = totalQty > 0 ? totalValue / totalQty : 0;

    return {
        item,
        summary: { totalQtyOnHand: totalQty, averageUnitCost: avgWac, totalValue },
        locations: balances,
    };
};

module.exports = { getStockBalances, getStockSummary, exportStockBalances, getItemStockProfile };
