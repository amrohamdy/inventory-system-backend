const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { getOBStatus } = require('./periodGuard.service');
const { logAction, EntityType } = require('./auditTrail.service');
const { generateDocNumber } = require('./docNumbering.service');

// ── GET PERIODS ───────────────────────────────────────────────────────────────
const getPeriods = async (tenantId) => {
    return prisma.periodClose.findMany({
        where: { tenantId },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
};

// ── GET PERIOD BY ID ──────────────────────────────────────────────────────────
const getPeriodById = async (id, tenantId) => {
    const period = await prisma.periodClose.findFirst({
        where: { id, tenantId },
        include: {
            snapshots: {
                take: 10, // preview only
            },
            _count: { select: { snapshots: true } },
        },
    });
    if (!period) throw Object.assign(new Error('Period not found'), { status: 404 });
    return period;
};

// ── CLOSE PERIOD ──────────────────────────────────────────────────────────────
// Takes a snapshot of ALL current balances and marks the period as CLOSED.
const closePeriod = async (tenantId, { year, month, notes }, userId) => {
    // Check if already closed
    const existing = await prisma.periodClose.findUnique({
        where: { tenantId_year_month: { tenantId, year, month: month || null } },
    });

    if (existing && existing.status === 'CLOSED') {
        throw Object.assign(new Error(`Period ${year}${month ? '/' + month : ''} is already closed`), { status: 400 });
    }

    // Get all current stock balances
    const balances = await prisma.stockBalance.findMany({
        where: { tenantId },
        select: {
            itemId: true,
            locationId: true,
            qtyOnHand: true,
            wacUnitCost: true,
        },
    });

    // Create or update period with snapshots
    const result = await prisma.$transaction(async (tx) => {
        // Upsert the period
        const period = existing
            ? await tx.periodClose.update({
                where: { id: existing.id },
                data: {
                    status: 'CLOSED',
                    closedAt: new Date(),
                    closedBy: userId,
                    notes,
                },
            })
            : await tx.periodClose.create({
                data: {
                    tenantId,
                    year,
                    month: month || null,
                    status: 'CLOSED',
                    closedAt: new Date(),
                    closedBy: userId,
                    notes,
                },
            });

        // Delete old snapshots if re-closing
        if (existing) {
            await tx.periodSnapshot.deleteMany({ where: { periodCloseId: period.id } });
        }

        // Create snapshots for all balances
        if (balances.length > 0) {
            await tx.periodSnapshot.createMany({
                data: balances.map(b => ({
                    periodCloseId: period.id,
                    itemId: b.itemId,
                    locationId: b.locationId,
                    closingQty: b.qtyOnHand,
                    closingValue: Number(b.qtyOnHand) * Number(b.wacUnitCost),
                    wacUnitCost: b.wacUnitCost,
                })),
            });
        }

        // ── Auto-lock Opening Balance after Period Close ──────────────────────
        // Once a period is officially closed, OB entries must be blocked.
        // Any corrections must go through Adjustment movements.
        await tx.tenantSetting.upsert({
            where: { tenantId_key: { tenantId, key: 'allowOpeningBalance' } },
            update: {
                value: 'LOCKED',
                reason: `Auto-locked: Period ${year}${month ? '/' + month : ''} closed at ${new Date().toISOString()}`,
            },
            create: {
                tenantId,
                key: 'allowOpeningBalance',
                value: 'LOCKED',
                reason: `Auto-locked: Period ${year}${month ? '/' + month : ''} closed at ${new Date().toISOString()}`,
            },
        });
        // ─────────────────────────────────────────────────────────────────────────

        return period;
    });

    return { ...result, snapshotCount: balances.length };
};

// ── REOPEN PERIOD ─────────────────────────────────────────────────────────────
const reopenPeriod = async (id, tenantId, userId) => {
    const period = await prisma.periodClose.findFirst({ where: { id, tenantId } });
    if (!period) throw Object.assign(new Error('Period not found'), { status: 404 });
    if (period.status === 'OPEN') throw Object.assign(new Error('Period is already open'), { status: 400 });

    const result = await prisma.periodClose.update({
        where: { id },
        data: { status: 'OPEN', closedAt: null, closedBy: null },
    });

    if (userId) {
        await logAction({
            tenantId,
            entityType: EntityType.PERIOD_CLOSE,
            entityId: id,
            action: 'REOPEN_PERIOD',
            changedBy: userId,
            note: `Period ${period.year}${period.month ? '/' + period.month : ''} reopened`,
        });
    }

    return result;
};

// ── GET OPENING BALANCE (from last closed period before given year) ───────────
const getOpeningBalance = async (tenantId, year) => {
    // Find the last closed period before this year (annual close of previous year)
    const lastClose = await prisma.periodClose.findFirst({
        where: {
            tenantId,
            status: 'CLOSED',
            year: year - 1,
            month: null, // annual close
        },
    });

    if (!lastClose) {
        // Try monthly close of December of previous year
        const decClose = await prisma.periodClose.findFirst({
            where: { tenantId, status: 'CLOSED', year: year - 1, month: 12 },
        });
        if (!decClose) return null;
        return prisma.periodSnapshot.findMany({ where: { periodCloseId: decClose.id } });
    }

    return prisma.periodSnapshot.findMany({ where: { periodCloseId: lastClose.id } });
};

module.exports = {
    getPeriods,
    getPeriodById,
    closePeriod,
    reopenPeriod,
    getOpeningBalance,
};
