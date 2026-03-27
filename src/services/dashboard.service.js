const prisma = require('../config/database');
const logger = require('../utils/logger');

/**
 * SaaS Phase 2 — Executive Dashboard Service
 *
 * Single consolidated query function that fires 7 parallel Prisma queries
 * and returns all 4 widget groups in one response.
 */

const getDashboardSummary = async (tenantId) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const [
        inventoryTotals,
        valueByStore,
        thisMonthMovements,
        prevMonthMovements,
        requisitionStats,
        agingData,
        topConsumed,
        topSlow,
        operationalHealth,
    ] = await Promise.all([
        // ── Q1: Inventory Overview Totals ────────────────────────────────
        (async () => {
            const [balances, storeCount, itemCount] = await Promise.all([
                prisma.stockBalance.aggregate({
                    where: { tenantId },
                    _sum: { qtyOnHand: true },
                }),
                prisma.location.count({ where: { tenantId, isActive: true } }),
                prisma.item.count({ where: { tenantId, isActive: true } }),
            ]);

            // Total inventory value = Σ(qtyOnHand × wacUnitCost) per balance row
            const valueResult = await prisma.$queryRaw`
                SELECT COALESCE(SUM("qtyOnHand" * "wacUnitCost"), 0)::float as "totalValue"
                FROM stock_balances
                WHERE "tenantId" = ${tenantId}::uuid
            `;

            return {
                totalValue: valueResult[0]?.totalValue || 0,
                totalStores: storeCount,
                totalActiveItems: itemCount,
                totalQtyOnHand: Number(balances._sum.qtyOnHand || 0),
            };
        })(),

        // ── Q2: Value by Department ───────────────────────────────────────────
        (async () => {
            const rows = await prisma.$queryRaw`
                SELECT d."name" as "departmentName",
                       COALESCE(SUM(sb."qtyOnHand" * sb."wacUnitCost"), 0)::float as "value"
                FROM stock_balances sb
                JOIN items i ON i."id" = sb."itemId"
                JOIN departments d ON d."id" = i."departmentId"
                WHERE sb."tenantId" = ${tenantId}::uuid
                GROUP BY d."id", d."name"
                ORDER BY "value" DESC
            `;
            return rows;
        })(),

        // ── Q3: This Month Movements ─────────────────────────────────────
        (async () => {
            const consumption = await prisma.$queryRaw`
                SELECT COALESCE(SUM("qtyOut" * "unitCost"), 0)::float as "value"
                FROM inventory_ledger
                WHERE "tenantId" = ${tenantId}::uuid
                  AND "movementType" IN ('ISSUE')
                  AND "createdAt" >= ${monthStart}
            `;
            const transfers = await prisma.inventoryLedger.count({
                where: {
                    tenantId,
                    movementType: 'TRANSFER_OUT',
                    createdAt: { gte: monthStart },
                },
            });
            const lossValue = await prisma.$queryRaw`
                SELECT COALESCE(SUM("qtyOut" * "unitCost"), 0)::float as "value"
                FROM inventory_ledger
                WHERE "tenantId" = ${tenantId}::uuid
                  AND "movementType" = 'BREAKAGE'
                  AND "createdAt" >= ${monthStart}
            `;
            return {
                consumptionValue: consumption[0]?.value || 0,
                transfersCount: transfers,
                lossValue: lossValue[0]?.value || 0,
            };
        })(),

        // ── Q4: Previous Month Movements (for Δ%) ────────────────────────
        (async () => {
            const consumption = await prisma.$queryRaw`
                SELECT COALESCE(SUM("qtyOut" * "unitCost"), 0)::float as "value"
                FROM inventory_ledger
                WHERE "tenantId" = ${tenantId}::uuid
                  AND "movementType" IN ('ISSUE')
                  AND "createdAt" >= ${prevMonthStart}
                  AND "createdAt" <= ${prevMonthEnd}
            `;
            const lossValue = await prisma.$queryRaw`
                SELECT COALESCE(SUM("qtyOut" * "unitCost"), 0)::float as "value"
                FROM inventory_ledger
                WHERE "tenantId" = ${tenantId}::uuid
                  AND "movementType" = 'BREAKAGE'
                  AND "createdAt" >= ${prevMonthStart}
                  AND "createdAt" <= ${prevMonthEnd}
            `;
            return {
                consumptionValue: consumption[0]?.value || 0,
                lossValue: lossValue[0]?.value || 0,
            };
        })(),

        // ── Q5: Requisition Fill Rate ────────────────────────────────────
        (async () => {
            const [total, fulfilled] = await Promise.all([
                prisma.storeRequisition.count({
                    where: {
                        tenantId,
                        status: { in: ['APPROVED', 'PARTIALLY_ISSUED', 'FULLY_ISSUED', 'CLOSED'] },
                        createdAt: { gte: monthStart },
                    },
                }),
                prisma.storeRequisition.count({
                    where: {
                        tenantId,
                        status: { in: ['FULLY_ISSUED', 'CLOSED'] },
                        createdAt: { gte: monthStart },
                    },
                }),
            ]);
            return {
                totalRequisitions: total,
                fulfilledRequisitions: fulfilled,
                fillRate: total > 0 ? Math.round((fulfilled / total) * 100) : 0,
            };
        })(),

        // ── Q6: Aging Buckets ────────────────────────────────────────────
        (async () => {
            const rows = await prisma.$queryRaw`
                SELECT
                    CASE
                        WHEN last_move IS NULL OR NOW() - last_move > INTERVAL '60 days' THEN '60+'
                        WHEN NOW() - last_move > INTERVAL '30 days' THEN '31-60'
                        ELSE '0-30'
                    END as bucket,
                    COUNT(*)::int as count,
                    COALESCE(SUM(sb."qtyOnHand" * sb."wacUnitCost"), 0)::float as "value"
                FROM stock_balances sb
                LEFT JOIN LATERAL (
                    SELECT MAX(il."createdAt") as last_move
                    FROM inventory_ledger il
                    WHERE il."itemId" = sb."itemId"
                      AND il."locationId" = sb."locationId"
                      AND il."tenantId" = sb."tenantId"
                ) lm ON true
                WHERE sb."tenantId" = ${tenantId}::uuid
                  AND sb."qtyOnHand" > 0
                GROUP BY bucket
                ORDER BY bucket
            `;
            return rows;
        })(),

        // ── Q7a: Top 5 Consumed Items ────────────────────────────────────
        (async () => {
            const rows = await prisma.$queryRaw`
                SELECT i."name" as "itemName",
                       SUM(il."qtyOut")::float as "totalQty",
                       SUM(il."qtyOut" * il."unitCost")::float as "totalValue"
                FROM inventory_ledger il
                JOIN items i ON i."id" = il."itemId"
                WHERE il."tenantId" = ${tenantId}::uuid
                  AND il."movementType" = 'ISSUE'
                  AND il."createdAt" >= ${monthStart}
                GROUP BY i."id", i."name"
                ORDER BY "totalValue" DESC
                LIMIT 5
            `;
            return rows;
        })(),

        // ── Q7b: Top 5 Slow Moving Items ─────────────────────────────────
        (async () => {
            const rows = await prisma.$queryRaw`
                SELECT i."name" as "itemName",
                       sb."qtyOnHand"::float as "qtyOnHand",
                       (sb."qtyOnHand" * sb."wacUnitCost")::float as "value",
                       MAX(il."createdAt") as "lastMovement"
                FROM stock_balances sb
                JOIN items i ON i."id" = sb."itemId"
                LEFT JOIN inventory_ledger il
                    ON il."itemId" = sb."itemId"
                   AND il."locationId" = sb."locationId"
                   AND il."tenantId" = sb."tenantId"
                WHERE sb."tenantId" = ${tenantId}::uuid
                  AND sb."qtyOnHand" > 0
                GROUP BY i."id", i."name", sb."qtyOnHand", sb."wacUnitCost"
                ORDER BY MAX(il."createdAt") ASC NULLS FIRST
                LIMIT 5
            `;
            return rows;
        })(),

        // ── Q8: Operational Health ───────────────────────────────────────
        (async () => {
            const [openReqs, pendingTransfers, pendingGrns, pendingLoss, overdueLoans, pendingStockReports] = await Promise.all([
                prisma.storeRequisition.findMany({
                    where: { tenantId, status: { in: ['SUBMITTED', 'APPROVED', 'PARTIALLY_ISSUED'] } },
                    select: { id: true, requisitionNo: true, status: true, requestedBy: true }
                }).catch(() => []),
                prisma.storeTransfer.findMany({
                    where: { tenantId, status: { in: ['SUBMITTED', 'APPROVED', 'IN_TRANSIT'] } },
                    select: { id: true, transferNo: true, status: true, sourceLocationId: true, destLocationId: true }
                }).catch(() => []),
                prisma.grnImport.findMany({
                    where: { tenantId, status: { in: ['DRAFT', 'VALIDATED', 'PENDING_APPROVAL'] } },
                    select: { id: true, grnNumber: true, status: true, vendorId: true }
                }).catch(() => []),
                prisma.movementDocument.findMany({
                    where: { tenantId, movementType: 'BREAKAGE', status: 'DRAFT' },
                    select: { id: true, documentNo: true, status: true, sourceLocationId: true }
                }).catch(() => []),
                prisma.getPass.findMany({
                    where: { tenantId, status: { in: ['OUT', 'PARTIALLY_RETURNED'] }, expectedReturnDate: { lt: now } },
                    select: { id: true, passNo: true, borrowingEntity: true, expectedReturnDate: true }
                }).catch(() => []),
                prisma.savedStockReport.findMany({
                    where: { tenantId, status: 'PENDING_APPROVAL' },
                    select: { id: true, reportNo: true, status: true }
                }).catch(() => [])
            ]);
            return {
                openReqsCount: openReqs.length,
                pendingTransfersCount: pendingTransfers.length,
                pendingGrnsCount: pendingGrns.length,
                pendingLossCount: pendingLoss.length,
                overdueLoansCount: overdueLoans.length,
                pendingStockReportsCount: pendingStockReports.length,
                details: {
                    openReqs: openReqs.slice(0, 5),
                    pendingTransfers: pendingTransfers.slice(0, 5),
                    pendingGrns: pendingGrns.slice(0, 5),
                    pendingLoss: pendingLoss.slice(0, 5),
                    overdueLoans: overdueLoans.slice(0, 5).map(p => ({
                        id: p.id,
                        loanNo: p.passNo, // Legacy mapping for UI compatibility 
                        qty: '-', 
                        borrowingEntity: p.borrowingEntity,
                        expectedReturnDate: p.expectedReturnDate
                    })),
                    pendingStockReports: pendingStockReports.slice(0, 5)
                }
            };
        })(),
    ]);

    // ── Compute deltas ───────────────────────────────────────────────────
    const calcDelta = (curr, prev) => {
        if (prev === 0) return curr > 0 ? 100 : 0;
        return Math.round(((curr - prev) / prev) * 100);
    };

    const consumptionDelta = calcDelta(thisMonthMovements.consumptionValue, prevMonthMovements.consumptionValue);
    const lossDelta = calcDelta(thisMonthMovements.lossValue, prevMonthMovements.lossValue);
    const lossVsConsumption = thisMonthMovements.consumptionValue > 0
        ? Math.round((thisMonthMovements.lossValue / thisMonthMovements.consumptionValue) * 100 * 10) / 10
        : 0;

    return {
        inventoryOverview: {
            ...inventoryTotals,
            valueByDepartment: valueByStore, // Reusing the same variable name from the Promise.all array for ease, but renaming the key payload to valueByDepartment
        },
        monthlyPerformance: {
            consumptionValue: thisMonthMovements.consumptionValue,
            consumptionDelta,
            transfersCount: thisMonthMovements.transfersCount,
            lossValue: thisMonthMovements.lossValue,
            lossDelta,
            fillRate: requisitionStats.fillRate,
            totalRequisitions: requisitionStats.totalRequisitions,
            fulfilledRequisitions: requisitionStats.fulfilledRequisitions,
        },
        riskIndicators: {
            aging: agingData,
            topConsumed,
            topSlow,
            lossVsConsumptionPct: lossVsConsumption,
        },
        operationalHealth,
        generatedAt: now.toISOString(),
    };
};

/**
 * Analytics chart data — consumption trend, department breakdown, top consumed, low stock
 */
const getChartData = async (tenantId) => {
    const now = new Date();

    // Generate last 6 months
    const months = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
            start: d,
            end: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999),
            label: d.toLocaleDateString('en', { month: 'short', year: '2-digit' }),
        });
    }

    const [consumptionByMonth, deptBreakdown, topConsumed, lowStockData] = await Promise.all([
        // 1. Consumption trend (last 6 months)
        Promise.all(months.map(async (m) => {
            const result = await prisma.inventoryLedger.aggregate({
                where: {
                    tenantId,
                    movementType: 'ISSUE',
                    createdAt: { gte: m.start, lte: m.end },
                },
                _sum: { qtyOut: true },
                _count: true,
            });
            // Also get breakage
            const breakage = await prisma.inventoryLedger.aggregate({
                where: {
                    tenantId,
                    movementType: 'BREAKAGE',
                    createdAt: { gte: m.start, lte: m.end },
                },
                _sum: { qtyOut: true },
            });
            return {
                month: m.label,
                consumption: Number(result._sum.qtyOut || 0),
                breakage: Number(breakage._sum.qtyOut || 0),
                transactions: result._count || 0,
            };
        })),

        // 2. Inventory value by department
        (async () => {
            const depts = await prisma.department.findMany({
                where: { tenantId, isActive: true },
                select: { id: true, name: true },
            });
            const results = await Promise.all(depts.map(async (dept) => {
                const value = await prisma.$queryRaw`
                    SELECT COALESCE(SUM(sb."qtyOnHand" * sb."wacUnitCost"), 0)::float as value
                    FROM stock_balances sb
                    JOIN items i ON sb."itemId" = i.id
                    WHERE sb."tenantId" = ${tenantId}::uuid
                    AND i."departmentId" = ${dept.id}::uuid
                `;
                const itemCount = await prisma.item.count({
                    where: { tenantId, departmentId: dept.id, isActive: true },
                });
                return { name: dept.name, value: value[0]?.value || 0, items: itemCount };
            }));
            return results.filter(r => r.value > 0 || r.items > 0).sort((a, b) => b.value - a.value);
        })(),

        // 3. Top 10 consumed items (last 30 days)
        (async () => {
            const thirtyAgo = new Date(now.getTime() - 30 * 86400000);
            const result = await prisma.inventoryLedger.groupBy({
                by: ['itemId'],
                where: {
                    tenantId,
                    movementType: 'ISSUE',
                    createdAt: { gte: thirtyAgo },
                },
                _sum: { qtyOut: true },
                orderBy: { _sum: { qtyOut: 'desc' } },
                take: 10,
            });
            const itemIds = result.map(r => r.itemId);
            const items = await prisma.item.findMany({
                where: { id: { in: itemIds } },
                select: { id: true, name: true },
            });
            const nameMap = Object.fromEntries(items.map(i => [i.id, i.name]));
            return result.map(r => ({
                name: nameMap[r.itemId] || 'Unknown',
                qty: Number(r._sum.qtyOut || 0),
            }));
        })(),

        // 4. Low stock summary — count DISTINCT items (not stockBalance rows per location)
        (async () => {
            const balances = await prisma.stockBalance.findMany({
                where: {
                    tenantId,
                    OR: [
                        { reorderPoint: { gt: 0 } },
                        { minQty: { gt: 0 } },
                        { maxQty: { gt: 0 } },
                    ]
                },
            });

            // Group by itemId and determine worst status per distinct item
            const itemMap = new Map(); // itemId → worst status: 'critical' | 'warning' | 'ok'
            for (const b of balances) {
                const qty = Number(b.qtyOnHand || 0);
                const min = Number(b.minQty || 0);
                const reorder = Number(b.reorderPoint || 0);

                let status = 'ok';
                if (qty === 0 || (min > 0 && qty < min)) status = 'critical';
                else if (reorder > 0 && qty <= reorder) status = 'warning';

                const prev = itemMap.get(b.itemId);
                // Worst-case: critical > warning > ok
                if (!prev || (status === 'critical') || (status === 'warning' && prev === 'ok')) {
                    itemMap.set(b.itemId, status);
                }
            }

            let critical = 0, warning = 0, ok = 0;
            for (const status of itemMap.values()) {
                if (status === 'critical') critical++;
                else if (status === 'warning') warning++;
                else ok++;
            }

            return [
                { name: 'Critical', value: critical, fill: '#ef4444' },
                { name: 'Warning', value: warning, fill: '#f59e0b' },
                { name: 'OK', value: ok, fill: '#22c55e' },
            ];
        })(),
    ]);

    return { consumptionByMonth, deptBreakdown, topConsumed, lowStockData };
};

/**
 * Per-branch metrics for org comparison (child tenants only).
 * Inventory value matches executive dashboard (Σ qtyOnHand × wacUnitCost).
 * Consumption: ISSUE ledger value for current calendar month.
 * Waste: BREAKAGE ledger value for current month (MovementType has no LOSS; aligns with dashboard loss).
 * Pending tasks: same pending definitions as operational health (transfers + GRNs + open stock counts).
 */
const aggregateBranchMetrics = async (tenantId, monthStart) => {
    const [
        inventoryRow,
        consumptionRow,
        wasteRow,
        pendingTransfers,
        pendingGrns,
        pendingInventories,
    ] = await Promise.all([
        prisma.$queryRaw`
            SELECT COALESCE(SUM("qtyOnHand" * "wacUnitCost"), 0)::float as "totalValue"
            FROM stock_balances
            WHERE "tenantId" = ${tenantId}::uuid
        `,
        prisma.$queryRaw`
            SELECT COALESCE(SUM("qtyOut" * "unitCost"), 0)::float as "value"
            FROM inventory_ledger
            WHERE "tenantId" = ${tenantId}::uuid
              AND "movementType" = 'ISSUE'
              AND "createdAt" >= ${monthStart}
        `,
        prisma.$queryRaw`
            SELECT COALESCE(SUM("qtyOut" * "unitCost"), 0)::float as "value"
            FROM inventory_ledger
            WHERE "tenantId" = ${tenantId}::uuid
              AND "movementType" = 'BREAKAGE'
              AND "createdAt" >= ${monthStart}
        `,
        prisma.storeTransfer.count({
            where: {
                tenantId,
                status: { in: ['SUBMITTED', 'APPROVED', 'IN_TRANSIT'] },
            },
        }),
        prisma.grnImport.count({
            where: {
                tenantId,
                status: { in: ['DRAFT', 'VALIDATED', 'PENDING_APPROVAL'] },
            },
        }),
        prisma.stockCountSession.count({
            where: {
                tenantId,
                status: { in: ['DRAFT', 'PENDING_APPROVAL'] },
            },
        }),
    ]);

    return {
        inventoryValue: Number(inventoryRow[0]?.totalValue || 0),
        consumption: Number(consumptionRow[0]?.value || 0),
        waste: Number(wasteRow[0]?.value || 0),
        pendingTasks: pendingTransfers + pendingGrns + pendingInventories,
    };
};

/**
 * @param {string} parentTenantId — root organization tenant id (parentId must be null)
 * @returns {Promise<Array<{ branchName: string, inventoryValue: number, consumption: number, waste: number, pendingTasks: number }>>}
 */
const getOrganizationSummary = async (parentTenantId) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const branches = await prisma.tenant.findMany({
        where: { parentId: parentTenantId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
    });

    const rows = await Promise.all(
        branches.map(async (b) => {
            const m = await aggregateBranchMetrics(b.id, monthStart);
            return {
                branchName: b.name,
                inventoryValue: m.inventoryValue,
                consumption: m.consumption,
                waste: m.waste,
                pendingTasks: m.pendingTasks,
            };
        }),
    );

    return rows;
};

module.exports = { getDashboardSummary, getChartData, getOrganizationSummary };
