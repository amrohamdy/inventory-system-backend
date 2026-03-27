const prisma = require('../config/database');

/**
 * Get low stock alerts — items where qtyOnHand <= reorderPoint (per StockBalance)
 */
const getLowStockAlerts = async (tenantId) => {
    // Get all balances where either reorderPoint OR minQty is set
    const balances = await prisma.stockBalance.findMany({
        where: {
            tenantId,
            OR: [
                { reorderPoint: { gt: 0 } },
                { minQty: { gt: 0 } },
            ],
        },
        include: {
            item: {
                select: {
                    id: true, name: true, barcode: true, imageUrl: true, unitPrice: true,
                    category: { select: { name: true } },
                    supplier: { select: { name: true } },
                    department: { select: { name: true } },
                },
            },
            location: { select: { id: true, name: true } },
        },
    });

    const alerts = [];
    for (const bal of balances) {
        const qty = Number(bal.qtyOnHand);
        const reorder = Number(bal.reorderPoint);
        const min = Number(bal.minQty);

        const isBelowReorder = reorder > 0 && qty <= reorder;
        const isBelowMin = min > 0 && qty < min;
        const isOutOfStock = qty === 0;

        if (!isOutOfStock && !isBelowMin && !isBelowReorder) continue;

        let severity;
        if (isOutOfStock) severity = 'critical';
        else if (isBelowMin) severity = 'high';
        else severity = 'warning';

        let message;
        if (isOutOfStock) {
            message = `${bal.item.name} is OUT OF STOCK at ${bal.location.name}!`;
        } else if (isBelowMin) {
            message = `${bal.item.name} stock (${qty}) is below minimum (${min}) at ${bal.location.name}`;
        } else {
            message = `${bal.item.name} stock (${qty}) is below reorder point (${reorder}) at ${bal.location.name}`;
        }

        alerts.push({
            id: `${bal.itemId}_${bal.locationId}`,
            type: 'LOW_STOCK',
            itemName: bal.item.name,
            barcode: bal.item.barcode,
            category: bal.item.category?.name || null,
            department: bal.item.department?.name || null,
            supplier: bal.item.supplier?.name || null,
            locationName: bal.location.name,
            currentStock: qty,
            reorderPoint: reorder,
            minQty: min,
            severity,
            message,
        });
    }

    // Sort: critical first, then high, warning, info
    const severityOrder = { critical: 0, high: 1, warning: 2, info: 3 };
    alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return alerts;
};

/**
 * Get notification summary (counts for bell badge)
 */
const getNotificationSummary = async (tenantId) => {
    const alerts = await getLowStockAlerts(tenantId);

    // Count pending approvals
    const pendingApprovals = await prisma.approvalRequest.count({
        where: { tenantId, status: 'PENDING' },
    }).catch(() => 0);

    // Count overdue asset loans (now Get Passes)
    const overdueLoans = await prisma.getPass.count({
        where: {
            tenantId,
            status: { in: ['OUT', 'PARTIALLY_RETURNED'] },
            expectedReturnDate: { lt: new Date() }
        },
    }).catch(() => 0);

    // Count pending sub-types if any
    const pendingBreakages = await prisma.approvalRequest.count({
        where: { tenantId, status: 'PENDING', type: 'BREAKAGE' },
    }).catch(() => 0);

    const pendingRequisitions = await prisma.approvalRequest.count({
        where: { tenantId, status: 'PENDING', type: 'REQUISITION' },
    }).catch(() => 0);

    const pendingStockReports = await prisma.approvalRequest.count({
        where: { tenantId, status: 'PENDING', type: 'STOCK_REPORT' },
    }).catch(() => 0);

    const overdueLoansList = await prisma.getPass.findMany({
        where: {
            tenantId,
            status: { in: ['OUT', 'PARTIALLY_RETURNED'] },
            expectedReturnDate: { lt: new Date() }
        },
        orderBy: { expectedReturnDate: 'asc' },
        take: 5
    }).catch(() => []);

    return {
        totalCount: alerts.length + pendingApprovals + overdueLoans,
        lowStock: alerts.length,
        criticalStock: alerts.filter(a => a.severity === 'critical').length,
        warningStock: alerts.filter(a => a.severity === 'warning').length,
        pendingApprovals,
        pendingBreakages,
        pendingRequisitions,
        pendingStockReports,
        overdueLoans,
        overdueLoansList,
        alerts: alerts.slice(0, 20), // Top 20 alerts
    };
};

module.exports = { getLowStockAlerts, getNotificationSummary };
