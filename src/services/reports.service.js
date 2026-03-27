const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const excelService = require('./excel.service');

/**
 * M13.1 - Stock Valuation Report
 * Shows current quantity on hand, WAC, and total value.
 * Grouped/filtered by Location and Category.
 */
const getStockValuation = async (tenantId, filters = {}) => {
    const { locationId, categoryId, page, limit } = filters;

    const where = { tenantId };
    if (locationId) where.locationId = locationId;
    if (categoryId) where.item = { categoryId };

    // Set up query
    const query = {
        where,
        include: {
            item: {
                include: { category: true }
            },
            location: true
        },
        orderBy: [
            { location: { name: 'asc' } },
            { item: { name: 'asc' } }
        ]
    };

    // Apply pagination if requested
    if (page && limit) {
        query.skip = (Number(page) - 1) * Number(limit);
        query.take = Number(limit);
    }

    const balances = await prisma.stockBalance.findMany(query);
    const totalCount = page && limit ? await prisma.stockBalance.count({ where }) : balances.length;

    // Map output for UI and Excel consistency
    const mappedData = balances.map(b => {
        const qty = Number(b.qtyOnHand);
        const wac = Number(b.wacUnitCost);
        return {
            locationName: b.location?.name || 'Unknown',
            itemCode: b.item.sku || b.item.barcode || b.item.id.substring(0, 8),
            itemName: b.item.name,
            category: b.item.category?.name || '-',
            qtyOnHand: qty,
            wacUnitCost: wac,
            totalValue: qty * wac,
            lastUpdated: b.lastUpdated
        };
    });

    // Calculate Summary Totals
    const summary = mappedData.reduce((acc, curr) => {
        acc.totalQty += curr.qtyOnHand;
        acc.totalValue += curr.totalValue;
        return acc;
    }, { totalQty: 0, totalValue: 0 });

    return {
        data: mappedData,
        summary,
        total: totalCount,
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : totalCount,
        filters
    };
};

/**
 * M13.2 - Movement History Report
 * Shows timeline of inventory transactions.
 */
const getMovementHistory = async (tenantId, filters = {}) => {
    const { dateFrom, dateTo, locationId, itemId, movementType, page, limit } = filters;

    if (!dateFrom || !dateTo) {
        throw new Error("dateFrom and dateTo are mandatory for Movement History");
    }

    const fromDate = new Date(dateFrom);
    const toDate = new Date(dateTo);
    // Ensure toDate includes the end of the day if it's just a date string
    toDate.setHours(23, 59, 59, 999);

    const where = {
        tenantId,
        createdAt: {
            gte: fromDate,
            lte: toDate
        }
    };

    if (locationId) where.locationId = locationId;
    if (itemId) where.itemId = itemId;
    if (movementType) where.movementType = movementType;

    const query = {
        where,
        include: {
            item: { include: { category: true } },
            location: true,
            createdByUser: true
        },
        orderBy: { createdAt: 'desc' }
    };

    if (page && limit) {
        query.skip = (Number(page) - 1) * Number(limit);
        query.take = Number(limit);
    }

    const movements = await prisma.inventoryLedger.findMany(query);
    const totalCount = page && limit ? await prisma.inventoryLedger.count({ where }) : movements.length;

    const mappedData = movements.map(m => {
        const qtyIn = Number(m.qtyIn);
        const qtyOut = Number(m.qtyOut);
        return {
            date: m.createdAt,
            locationName: m.location?.name || 'Unknown',
            itemCode: m.item.sku || m.item.barcode || m.item.id.substring(0, 8),
            itemName: m.item.name,
            category: m.item.category?.name || '-',
            movementType: m.movementType,
            referenceNo: m.referenceNo || m.referenceId || '-',
            qtyIn: qtyIn,
            qtyOut: qtyOut,
            unitCost: Number(m.unitCost),
            totalValue: Number(m.totalValue),
            user: m.createdByUser ? `${m.createdByUser.firstName} ${m.createdByUser.lastName}` : 'System',
            notes: m.notes || '-'
        };
    });

    const summary = mappedData.reduce((acc, curr) => {
        acc.totalQtyIn += curr.qtyIn;
        acc.totalQtyOut += curr.qtyOut;
        // Total value impacted is sum of all movement values (both in and out)
        acc.totalValueImpacted += curr.totalValue;
        return acc;
    }, { totalQtyIn: 0, totalQtyOut: 0, totalValueImpacted: 0 });

    return {
        data: mappedData,
        summary,
        total: totalCount,
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : totalCount,
        filters
    };
};

/**
 * M13.3 - Breakage & Loss Report
 *
 * Definition:
 *   - inventoryLedger.movementType = 'BREAKAGE'
 *   - parent movementDocument.status = 'POSTED'
 *   - Date filter = posting date = inventoryLedger.createdAt
 *
 * documentCount = COUNT DISTINCT referenceNo (not row count)
 */
const getBreakageReport = async (tenantId, filters = {}) => {
    const { dateFrom, dateTo, locationId } = filters;

    if (!dateFrom || !dateTo) {
        throw new Error('dateFrom and dateTo are mandatory for Breakage Report');
    }

    const fromDate = new Date(dateFrom);
    const toDate = new Date(dateTo);
    toDate.setHours(23, 59, 59, 999);

    const where = {
        tenantId,
        movementType: 'BREAKAGE',
        createdAt: {
            gte: fromDate,
            lte: toDate,
        },
    };

    if (locationId) where.locationId = locationId;

    const ledgerRows = await prisma.inventoryLedger.findMany({
        where,
        include: {
            item: {
                include: {
                    category: true,
                    itemUnits: { include: { unit: true } }
                },
            },
            location: true,
            createdByUser: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'asc' },
    });

    // Fetch parent document reasons in one query (for Remarks column)
    // referenceId on each ledger row points to movementDocument.id
    const referenceIds = [...new Set(ledgerRows.map(r => r.referenceId).filter(Boolean))];
    let reasonMap = {};
    if (referenceIds.length > 0) {
        const docs = await prisma.movementDocument.findMany({
            where: { id: { in: referenceIds }, tenantId, status: 'POSTED' },
            select: { id: true, reason: true },
        });
        reasonMap = Object.fromEntries(docs.map(d => [d.id, d.reason]));
    }

    const data = ledgerRows
        // Only include rows whose parent doc is POSTED (guard for soft-filter)
        .filter(r => !r.referenceId || reasonMap[r.referenceId] !== undefined)
        .map(r => {
            const qty = Number(r.qtyOut);
            const unitCost = Number(r.unitCost);
            const totalCost = Number(r.totalValue);
            return {
                postingDate: r.createdAt,          // UI label: "Posting Date"
                referenceNo: r.referenceNo || r.referenceId || '-',
                locationName: r.location?.name || 'Unknown',
                itemCode: r.item?.sku || r.item?.barcode || r.item?.id?.substring(0, 8) || '-',
                itemName: r.item?.name || '-',
                uom: r.item?.itemUnits?.find(iu => iu.unitType === 'BASE')?.unit?.name || '-',
                qty,
                unitCost,
                totalCost,
                remarks: (r.referenceId && reasonMap[r.referenceId]) || r.notes || '-',
                postedBy: r.createdByUser
                    ? `${r.createdByUser.firstName} ${r.createdByUser.lastName}`
                    : 'System',
            };
        });

    // Totals
    const totalQty = data.reduce((s, r) => s + r.qty, 0);
    const totalAmount = data.reduce((s, r) => s + r.totalCost, 0);
    // documentCount = distinct Ref No (not row count)
    const documentCount = new Set(data.map(r => r.referenceNo).filter(n => n !== '-')).size;

    return {
        data,
        totals: {
            totalQty: parseFloat(totalQty.toFixed(4)),
            totalAmount: parseFloat(totalAmount.toFixed(4)),
            documentCount,
        },
        filters: {
            dateFrom,
            dateTo,
            locationId: locationId || null,
        },
    };
};

/**
 * M13.4 - Stock Count Variance Report
 *
 * Shows variance between book quantity and counted quantity.
 * Date filter = countDate
 */
const getCountVariances = async (tenantId, filters = {}) => {
    const { dateFrom, dateTo, locationId } = filters;

    if (!dateFrom || !dateTo) {
        throw new Error('dateFrom and dateTo are mandatory for Count Variances report');
    }

    const fromDate = new Date(dateFrom);
    const toDate = new Date(dateTo);
    toDate.setHours(23, 59, 59, 999);

    const where = {
        tenantId,
        countDate: {
            gte: fromDate,
            lte: toDate,
        },
    };

    if (locationId) where.locationId = locationId;

    const sessions = await prisma.stockCountSession.findMany({
        where,
        include: {
            location: true,
            createdByUser: { select: { firstName: true, lastName: true } },
            lines: {
                include: {
                    item: {
                        include: { category: true, itemUnits: { include: { unit: true } } }
                    }
                }
            }
        },
        orderBy: { countDate: 'asc' }
    });

    const data = [];
    sessions.forEach(session => {
        session.lines.forEach(line => {
            const bookQty = Number(line.bookQty || 0);
            const countedQty = line.countedQty !== null ? Number(line.countedQty) : null;
            const varianceQty = line.varianceQty !== null ? Number(line.varianceQty) : 0;
            const wacUnitCost = Number(line.wacUnitCost || 0);
            const varianceValue = line.varianceValue !== null ? Number(line.varianceValue) : 0;

            // Include lines that have been counted
            if (countedQty !== null) {
                data.push({
                    sessionNo: session.sessionNo,
                    countDate: session.countDate,
                    locationName: session.location?.name || 'Unknown',
                    itemCode: line.item?.sku || line.item?.barcode || line.item?.id?.substring(0, 8) || '-',
                    itemName: line.item?.name || '-',
                    category: line.item?.category?.name || '-',
                    uom: line.item?.itemUnits?.find(iu => iu.unitType === 'BASE')?.unit?.name || '-',
                    bookQty,
                    countedQty,
                    varianceQty,
                    wacUnitCost,
                    varianceValue: parseFloat(varianceValue.toFixed(4)),
                    status: session.status,
                    notes: line.notes || session.notes || '-',
                    postedBy: session.createdByUser
                        ? `${session.createdByUser.firstName} ${session.createdByUser.lastName}`
                        : 'System',
                });
            }
        });
    });

    const totalVarianceQty = data.reduce((s, r) => s + r.varianceQty, 0);
    const totalVarianceValue = data.reduce((s, r) => s + r.varianceValue, 0);
    const totalBookQty = data.reduce((s, r) => s + r.bookQty, 0);
    const totalCountedQty = data.reduce((s, r) => s + r.countedQty, 0);
    const sessionCount = new Set(data.map(r => r.sessionNo)).size;

    return {
        data,
        totals: {
            totalBookQty: parseFloat(totalBookQty.toFixed(4)),
            totalCountedQty: parseFloat(totalCountedQty.toFixed(4)),
            totalVarianceQty: parseFloat(totalVarianceQty.toFixed(4)),
            totalVarianceValue: parseFloat(totalVarianceValue.toFixed(4)),
            sessionCount,
        },
        filters: {
            dateFrom,
            dateTo,
            locationId: locationId || null,
        },
    };
};

/**
 * M13.5 Opening-Movement-Closing (OMC) Report
 * Fetches OB, In/Out, and CB strictly from InventoryLedger.
 */
const getOmcReport = async (tenantId, { dateFrom, dateTo, locationId, categoryId }) => {
    if (!dateFrom || !dateTo || !locationId) {
        throw new Error('dateFrom, dateTo, and locationId are mandatory for the OMC report');
    }

    const fromDate = new Date(dateFrom);
    const toDate = new Date(dateTo);
    toDate.setHours(23, 59, 59, 999);

    // 1. Fetch relevant items
    const itemWhere = { tenantId, isActive: true };
    if (categoryId) itemWhere.categoryId = categoryId;

    const items = await prisma.item.findMany({
        where: itemWhere,
        include: {
            category: true,
            itemUnits: { include: { unit: true } }
        },
        orderBy: { name: 'asc' },
    });

    const data = [];

    // Parallelize processing for each item
    await Promise.all(items.map(async (item) => {
        // Find OB: last entry strictly BEFORE dateFrom
        const obEntry = await prisma.inventoryLedger.findFirst({
            where: {
                tenantId,
                itemId: item.id,
                locationId,
                createdAt: { lt: fromDate }
            },
            orderBy: [
                { createdAt: 'desc' },
                { id: 'desc' }
            ]
        });

        const obQty = obEntry ? Number(obEntry.runningBalance) : 0;
        const obVal = obEntry ? Number(obEntry.runningBalanceValue) : 0;

        // Find Movements: between dateFrom and dateTo
        const movements = await prisma.inventoryLedger.findMany({
            where: {
                tenantId,
                itemId: item.id,
                locationId,
                createdAt: {
                    gte: fromDate,
                    lte: toDate
                }
            }
        });

        let inQty = 0;
        let inVal = 0;
        let outQty = 0;
        let outVal = 0;

        for (const mov of movements) {
            const qIn = Number(mov.qtyIn) || 0;
            const qOut = Number(mov.qtyOut) || 0;
            const uCost = Number(mov.unitCost) || 0;

            inQty += qIn;
            inVal += (qIn * uCost);
            outQty += qOut;
            outVal += (qOut * uCost);
        }

        const cbQty = obQty + inQty - outQty;
        const cbVal = obVal + inVal - outVal;

        // Include row if there is ANY activity or balance
        if (obQty !== 0 || inQty !== 0 || outQty !== 0 || cbQty !== 0) {
            data.push({
                itemId: item.id,
                itemCode: item.sku || item.barcode || item.id.substring(0, 8) || '-',
                itemName: item.name || '-',
                category: item?.category?.name || '-',
                uom: item?.itemUnits?.find(iu => iu.unitType === 'BASE')?.unit?.name || '-',

                obQty: parseFloat(obQty.toFixed(4)),
                obVal: parseFloat(obVal.toFixed(4)),
                inQty: parseFloat(inQty.toFixed(4)),
                inVal: parseFloat(inVal.toFixed(4)),
                outQty: parseFloat(outQty.toFixed(4)),
                outVal: parseFloat(outVal.toFixed(4)),
                cbQty: parseFloat(cbQty.toFixed(4)),
                cbVal: parseFloat(cbVal.toFixed(4))
            });
        }
    }));

    // Sort the final result by itemName since parallel Promises return out of order
    data.sort((a, b) => a.itemName.localeCompare(b.itemName));

    const totals = {
        totalObQty: parseFloat(data.reduce((s, r) => s + r.obQty, 0).toFixed(4)),
        totalObVal: parseFloat(data.reduce((s, r) => s + r.obVal, 0).toFixed(4)),
        totalInQty: parseFloat(data.reduce((s, r) => s + r.inQty, 0).toFixed(4)),
        totalInVal: parseFloat(data.reduce((s, r) => s + r.inVal, 0).toFixed(4)),
        totalOutQty: parseFloat(data.reduce((s, r) => s + r.outQty, 0).toFixed(4)),
        totalOutVal: parseFloat(data.reduce((s, r) => s + r.outVal, 0).toFixed(4)),
        totalCbQty: parseFloat(data.reduce((s, r) => s + r.cbQty, 0).toFixed(4)),
        totalCbVal: parseFloat(data.reduce((s, r) => s + r.cbVal, 0).toFixed(4)),
    };

    return {
        data,
        totals,
        filters: { dateFrom, dateTo, locationId, categoryId: categoryId || null },
    };
};

/**
 * M13.6 — Transfer History Report
 * All inter-store transfers filterable by date, source, destination, item.
 */
const getTransferHistoryReport = async (tenantId, { dateFrom, dateTo, sourceLocationId, destLocationId, itemId, status } = {}) => {
    const where = { tenantId };
    if (sourceLocationId) where.sourceLocationId = sourceLocationId;
    if (destLocationId) where.destLocationId = destLocationId;
    if (status) where.status = status;
    if (dateFrom || dateTo) {
        where.transferDate = {};
        if (dateFrom) where.transferDate.gte = new Date(dateFrom);
        if (dateTo) where.transferDate.lte = new Date(dateTo);
    }

    const transfers = await prisma.storeTransfer.findMany({
        where,
        include: {
            sourceLocation: { select: { name: true } },
            destLocation: { select: { name: true } },
            requestedByUser: { select: { firstName: true, lastName: true } },
            lines: {
                include: {
                    item: { select: { name: true } },
                    uom: { select: { abbreviation: true } },
                },
            },
        },
        orderBy: { transferDate: 'desc' },
    });

    // Filter by itemId if given
    const filtered = itemId
        ? transfers.filter(t => t.lines.some(l => l.itemId === itemId))
        : transfers;

    const rows = [];
    for (const t of filtered) {
        for (const l of t.lines) {
            if (itemId && l.itemId !== itemId) continue;
            rows.push({
                transferNo: t.transferNo,
                transferDate: t.transferDate,
                status: t.status,
                sourceLocation: t.sourceLocation?.name,
                destLocation: t.destLocation?.name,
                requestedBy: `${t.requestedByUser?.firstName ?? ''} ${t.requestedByUser?.lastName ?? ''}`.trim(),
                itemName: l.item?.name,
                uom: l.uom?.abbreviation,
                requestedQty: Number(l.requestedQty),
                receivedQty: l.receivedQty != null ? Number(l.receivedQty) : null,
                unitCost: Number(l.unitCost),
                totalValue: Number(l.totalValue),
            });
        }
    }

    const totalValue = rows.reduce((s, r) => s + r.totalValue, 0);
    const totalQty = rows.reduce((s, r) => s + r.requestedQty, 0);
    return { total: rows.length, totalQty, totalValue, data: rows };
};

/**
 * M13.7 — Breakage / Loss P&L Report
 * Financial loss aggregated by subtype and month.
 */
const getBreakagePLReport = async (tenantId, { dateFrom, dateTo, locationId, documentSubtype } = {}) => {
    const where = {
        tenantId,
        movementType: 'BREAKAGE',
        status: 'POSTED',
    };
    if (locationId) where.sourceLocationId = locationId;
    if (documentSubtype) where.documentSubtype = documentSubtype;
    if (dateFrom || dateTo) {
        where.postedAt = {};
        if (dateFrom) where.postedAt.gte = new Date(dateFrom);
        if (dateTo) where.postedAt.lte = new Date(dateTo);
    }

    const docs = await prisma.movementDocument.findMany({
        where,
        include: {
            lines: true,
        },
        orderBy: { postedAt: 'desc' },
    });

    // Build a location map for resolving names
    const locIds = [...new Set(docs.map(d => d.sourceLocationId).filter(Boolean))];
    const locMap = {};
    if (locIds.length > 0) {
        const locs = await prisma.location.findMany({ where: { id: { in: locIds } }, select: { id: true, name: true } });
        for (const l of locs) locMap[l.id] = l.name;
    }

    // Pull WAC costs from ledger entries
    const allRows = [];
    let grandTotalLoss = 0;

    for (const doc of docs) {
        const month = doc.postedAt
            ? doc.postedAt.toISOString().slice(0, 7)
            : doc.createdAt.toISOString().slice(0, 7);

        const ledgerEntries = await prisma.inventoryLedger.findMany({
            where: { tenantId, referenceId: doc.id },
        });

        const docLoss = ledgerEntries.reduce((s, e) => s + Number(e.totalValue), 0);
        grandTotalLoss += docLoss;

        allRows.push({
            documentNo: doc.documentNo,
            documentSubtype: doc.documentSubtype ?? 'BREAKAGE',
            month,
            postedAt: doc.postedAt,
            location: locMap[doc.sourceLocationId] || null,
            reason: doc.reason,
            lineCount: doc.lines.length,
            totalLoss: docLoss,
        });
    }

    // Group by month + subtype
    const byMonth = {};
    for (const r of allRows) {
        const key = `${r.month}|${r.documentSubtype}`;
        if (!byMonth[key]) byMonth[key] = { month: r.month, documentSubtype: r.documentSubtype, count: 0, totalLoss: 0 };
        byMonth[key].count++;
        byMonth[key].totalLoss += r.totalLoss;
    }

    return {
        total: allRows.length,
        grandTotalLoss,
        monthly: Object.values(byMonth).sort((a, b) => b.month.localeCompare(a.month)),
        data: allRows,
    };
};

/**
 * M13.8 — Requisition Fill Rate Report
 * Fill %, partial rate, days to fulfill.
 */
const getRequisitionFillReport = async (tenantId, { dateFrom, dateTo, departmentName } = {}) => {
    const where = {
        tenantId,
        status: { in: ['CLOSED', 'FULLY_ISSUED', 'PARTIALLY_ISSUED'] },
    };
    if (departmentName) where.departmentName = { contains: departmentName, mode: 'insensitive' };
    if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) where.createdAt.gte = new Date(dateFrom);
        if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const reqs = await prisma.storeRequisition.findMany({
        where,
        include: {
            lines: true,
            requestedByUser: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
    });

    const rows = reqs.map(r => {
        const totalRequested = r.lines.reduce((s, l) => s + Number(l.requestedQty), 0);
        const totalIssued = r.lines.reduce((s, l) => s + Number(l.totalIssuedQty), 0);
        const fillPct = totalRequested > 0 ? (totalIssued / totalRequested) * 100 : 0;
        const isPartial = fillPct > 0 && fillPct < 100;
        const daysToFulfill = r.closedAt
            ? Math.round((new Date(r.closedAt) - new Date(r.createdAt)) / 86400000)
            : null;

        return {
            requisitionNo: r.requisitionNo,
            departmentName: r.departmentName,
            status: r.status,
            createdAt: r.createdAt,
            closedAt: r.closedAt,
            requestedBy: `${r.requestedByUser?.firstName ?? ''} ${r.requestedByUser?.lastName ?? ''}`.trim(),
            totalRequested,
            totalIssued,
            fillPct: parseFloat(fillPct.toFixed(2)),
            isPartial,
            daysToFulfill,
        };
    });

    const avg = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
    const filled = rows.filter(r => r.daysToFulfill != null);
    return {
        total: rows.length,
        avgFillPct: parseFloat((avg(rows.map(r => r.fillPct)) ?? 0).toFixed(2)),
        avgDaysToFulfill: filled.length ? parseFloat(avg(filled.map(r => r.daysToFulfill)).toFixed(1)) : null,
        partialRate: parseFloat(((rows.filter(r => r.isPartial).length / (rows.length || 1)) * 100).toFixed(2)),
        data: rows,
    };
};

/**
 * M13.9 — Inventory Aging Report
 * Items with last movement older than `days` threshold.
 */
const getInventoryAgingReport = async (tenantId, { locationId, days = 30, page = 1, limit = 50 } = {}) => {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - Number(days));

    const where = { tenantId, qtyOnHand: { gt: 0 } };
    if (locationId) where.locationId = locationId;

    const balances = await prisma.stockBalance.findMany({
        where,
        include: {
            item: { select: { name: true, barcode: true } },
            location: { select: { name: true } },
        },
        orderBy: { lastUpdated: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
    });

    const rows = balances
        .filter(b => !b.lastUpdated || b.lastUpdated < threshold)
        .map(b => ({
            itemName: b.item?.name,
            barcode: b.item?.barcode,
            locationName: b.location?.name,
            qtyOnHand: Number(b.qtyOnHand),
            wacUnitCost: Number(b.wacUnitCost),
            totalValue: Number(b.qtyOnHand) * Number(b.wacUnitCost),
            lastMovement: b.lastUpdated,
            agingDays: b.lastUpdated
                ? Math.floor((Date.now() - new Date(b.lastUpdated)) / 86400000)
                : null,
        }));

    rows.sort((a, b) => (b.agingDays ?? 9999) - (a.agingDays ?? 9999));

    return {
        total: rows.length,
        threshold: `${days} days`,
        totalValue: rows.reduce((s, r) => s + r.totalValue, 0),
        data: rows,
    };
};

module.exports = {
    getStockValuation,
    getMovementHistory,
    getBreakageReport,
    getCountVariances,
    getOmcReport,
    // Phase 6
    getTransferHistoryReport,
    getBreakagePLReport,
    getRequisitionFillReport,
    getInventoryAgingReport,
};
