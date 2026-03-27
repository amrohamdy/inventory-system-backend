'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ─── Auto-number ──────────────────────────────────────────────────────────────

const generateIssueNo = async (tenantId) => {
    const prefix = `ISS-${new Date().toISOString().slice(0, 7).replace('-', '')}`;
    const last = await prisma.storeIssue.findFirst({
        where: { tenantId, issueNo: { startsWith: prefix } },
        orderBy: { issueNo: 'desc' },
        select: { issueNo: true },
    });
    const seq = last ? parseInt(last.issueNo.split('-').pop()) + 1 : 1;
    return `${prefix}-${String(seq).padStart(4, '0')}`;
};

// ─── Create Draft Issue ───────────────────────────────────────────────────────

/**
 * Create a DRAFT Issue linked to an APPROVED or PARTIALLY_ISSUED requisition.
 * Validates:
 *  1. Requisition status is APPROVED | PARTIALLY_ISSUED
 *  2. Each line: issuedQty <= remaining (requestedQty - totalIssuedQty)
 *  3. Stock balance >= issuedQty (hard block — no override)
 */
const createIssueDraft = async ({ tenantId, userId, requisitionId, issueDate, notes, lines = [] }) => {
    if (!requisitionId) throw Object.assign(new Error('requisitionId is required'), { status: 400 });
    if (lines.length === 0) throw Object.assign(new Error('At least one issue line is required'), { status: 400 });

    // ── Guard: requisition status ──────────────────────────────────
    const req = await prisma.storeRequisition.findFirst({
        where: { id: requisitionId, tenantId },
        include: { lines: true },
    });
    if (!req) throw Object.assign(new Error('Requisition not found'), { status: 404 });
    if (!['APPROVED', 'PARTIALLY_ISSUED'].includes(req.status))
        throw Object.assign(
            new Error(`Requisition must be APPROVED or PARTIALLY_ISSUED to issue (current: ${req.status})`),
            { status: 403 }
        );

    // ── Guard: qty + stock per line ────────────────────────────────
    const validatedLines = [];
    for (const l of lines) {
        const reqLine = req.lines.find(rl => rl.id === l.requisitionLineId);
        if (!reqLine) throw Object.assign(new Error(`RequisitionLine ${l.requisitionLineId} not found`), { status: 400 });

        const remaining = Number(reqLine.requestedQty) - Number(reqLine.totalIssuedQty);
        if (Number(l.issuedQty) <= 0)
            throw Object.assign(new Error(`issuedQty must be > 0 for line ${reqLine.id}`), { status: 400 });
        if (Number(l.issuedQty) > remaining)
            throw Object.assign(
                new Error(`issuedQty (${l.issuedQty}) exceeds remaining qty (${remaining.toFixed(4)}) for item ${reqLine.itemId}`),
                { status: 422 }
            );

        // Stock balance check
        const balance = await prisma.stockBalance.findUnique({
            where: { tenantId_itemId_locationId: { tenantId, itemId: reqLine.itemId, locationId: req.locationId } },
        });
        const onHand = balance ? Number(balance.qtyOnHand) : 0;
        if (onHand < Number(l.issuedQty))
            throw Object.assign(
                new Error(`Insufficient stock for item ${reqLine.itemId}: available=${onHand.toFixed(4)}, requested=${l.issuedQty}`),
                { status: 422, details: { itemId: reqLine.itemId, onHand, requested: l.issuedQty } }
            );

        validatedLines.push({
            requisitionLineId: reqLine.id,
            itemId: reqLine.itemId,
            uomId: reqLine.uomId,
            issuedQty: Number(l.issuedQty),
        });
    }

    const issueNo = await generateIssueNo(tenantId);

    return prisma.storeIssue.create({
        data: {
            tenantId,
            issueNo,
            requisitionId,
            issueDate: issueDate ? new Date(issueDate) : new Date(),
            issuedBy: userId,
            notes,
            lines: {
                create: validatedLines.map(l => ({
                    requisitionLineId: l.requisitionLineId,
                    itemId: l.itemId,
                    uomId: l.uomId,
                    issuedQty: l.issuedQty,
                })),
            },
        },
        include: { lines: true },
    });
};

// ─── Atomic Post Issue ────────────────────────────────────────────────────────

/**
 * ATOMIC: Post all issue lines to InventoryLedger (OUT), reduce StockBalance,
 * update requisition line totals, and auto-advance requisition status.
 * Full rollback on any failure.
 */
const postIssue = async (issueId, tenantId, userId) => {
    const issue = await prisma.storeIssue.findFirst({
        where: { id: issueId, tenantId },
        include: {
            lines: true,
            requisition: { include: { lines: true } },
        },
    });
    if (!issue) throw Object.assign(new Error('Issue not found'), { status: 404 });
    if (issue.status === 'POSTED')
        throw Object.assign(new Error('Issue is already POSTED'), { status: 423 });
    if (!['APPROVED', 'PARTIALLY_ISSUED'].includes(issue.requisition.status))
        throw Object.assign(new Error('Associated requisition is not in an issuable state'), { status: 422 });

    await prisma.$transaction(async (tx) => {
        for (const line of issue.lines) {
            // Current WAC from StockBalance
            const balance = await tx.stockBalance.findUnique({
                where: {
                    tenantId_itemId_locationId: {
                        tenantId,
                        itemId: line.itemId,
                        locationId: issue.requisition.locationId,
                    }
                },
            });

            if (!balance || Number(balance.qtyOnHand) < Number(line.issuedQty))
                throw new Error(`Insufficient stock at posting time for item ${line.itemId}. Aborting.`);

            const wac = Number(balance.wacUnitCost);
            const qtyOut = Number(line.issuedQty);
            const totalValue = qtyOut * wac;
            const newQty = Number(balance.qtyOnHand) - qtyOut;

            // Reduce StockBalance
            await tx.stockBalance.update({
                where: {
                    tenantId_itemId_locationId: {
                        tenantId,
                        itemId: line.itemId,
                        locationId: issue.requisition.locationId,
                    }
                },
                data: { qtyOnHand: newQty, lastUpdated: new Date() },
            });

            // WAC stays unchanged on OUT — only IN movements affect WAC
            // Update IssueLine with costs
            await tx.storeIssueLine.update({
                where: { id: line.id },
                data: { unitCost: wac, totalValue },
            });

            // Create Ledger OUT entry
            await tx.inventoryLedger.create({
                data: {
                    tenantId,
                    itemId: line.itemId,
                    locationId: issue.requisition.locationId,
                    movementType: 'ISSUE',
                    qtyIn: 0,
                    qtyOut,
                    unitCost: wac,
                    totalValue,
                    referenceType: 'REQ_ISSUE',
                    referenceId: issue.id,
                    referenceNo: `${issue.requisition.requisitionNo} / ${issue.issueNo}`,
                    notes: `Issue: ${issue.issueNo} | Dept: ${issue.requisition.departmentName}`,
                    createdBy: userId,
                },
            });

            // Update RequisitionLine.totalIssuedQty
            const reqLine = issue.requisition.lines.find(l => l.id === line.requisitionLineId);
            await tx.storeRequisitionLine.update({
                where: { id: line.requisitionLineId },
                data: {
                    totalIssuedQty: Number(reqLine.totalIssuedQty) + qtyOut,
                },
            });
        }

        // ── Lock the Issue ──
        await tx.storeIssue.update({
            where: { id: issueId },
            data: { status: 'POSTED', postedAt: new Date(), updatedAt: new Date() },
        });

        // ── Recompute requisition status ──
        // Re-read all lines after updates
        const updatedLines = await tx.storeRequisitionLine.findMany({
            where: { requisitionId: issue.requisitionId },
        });
        const allFull = updatedLines.every(l => Number(l.totalIssuedQty) >= Number(l.requestedQty));
        const anyIssued = updatedLines.some(l => Number(l.totalIssuedQty) > 0);

        let newReqStatus = issue.requisition.status;
        if (allFull) {
            newReqStatus = 'FULLY_ISSUED';
        } else if (anyIssued) {
            newReqStatus = 'PARTIALLY_ISSUED';
        }

        const reqUpdate = {
            status: newReqStatus,
            updatedAt: new Date(),
        };
        if (allFull) {
            reqUpdate.fullyIssuedAt = new Date();
            reqUpdate.closedAt = new Date();  // Auto-close
            reqUpdate.status = 'CLOSED';
        }

        await tx.storeRequisition.update({
            where: { id: issue.requisitionId },
            data: reqUpdate,
        });
    });

    return prisma.storeIssue.findUnique({
        where: { id: issueId },
        include: {
            lines: {
                include: {
                    item: { select: { name: true } },
                    uom: { select: { abbreviation: true } },
                },
            },
        },
    });
};

// ─── Queries ─────────────────────────────────────────────────────────────────

const listIssues = async (tenantId, { requisitionId, status, page = 1, limit = 20 } = {}) => {
    const where = {
        tenantId,
        ...(requisitionId ? { requisitionId } : {}),
        ...(status ? { status } : {}),
    };
    const [total, data] = await Promise.all([
        prisma.storeIssue.count({ where }),
        prisma.storeIssue.findMany({
            where,
            include: {
                requisition: { select: { requisitionNo: true, departmentName: true } },
                issuedByUser: { select: { firstName: true, lastName: true } },
                _count: { select: { lines: true } },
            },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);
    return { total, page, limit, data };
};

const getIssue = async (id, tenantId) => {
    const issue = await prisma.storeIssue.findFirst({
        where: { id, tenantId },
        include: {
            requisition: { select: { requisitionNo: true, departmentName: true, locationId: true } },
            issuedByUser: { select: { firstName: true, lastName: true } },
            lines: {
                include: {
                    item: { select: { name: true } },
                    uom: { select: { abbreviation: true } },
                    requisitionLine: { select: { requestedQty: true, totalIssuedQty: true } },
                },
            },
        },
    });
    if (!issue) throw Object.assign(new Error('Issue not found'), { status: 404 });
    return issue;
};

const deleteIssue = async (id, tenantId) => {
    const issue = await prisma.storeIssue.findFirst({ where: { id, tenantId } });
    if (!issue) throw Object.assign(new Error('Issue not found'), { status: 404 });
    if (issue.status === 'POSTED')
        throw Object.assign(new Error('Cannot delete a POSTED issue — it is permanently locked'), { status: 423 });
    await prisma.storeIssue.delete({ where: { id } });
};

const updateIssueDraft = async (id, tenantId, { notes }) => {
    const issue = await prisma.storeIssue.findFirst({ where: { id, tenantId } });
    if (!issue) throw Object.assign(new Error('Issue not found'), { status: 404 });
    if (issue.status === 'POSTED')
        throw Object.assign(new Error('Cannot edit a POSTED issue — it is permanently locked'), { status: 423 });
    return prisma.storeIssue.update({
        where: { id },
        data: { notes, updatedAt: new Date() },
    });
};

module.exports = {
    createIssueDraft,
    postIssue,
    listIssues,
    getIssue,
    deleteIssue,
    updateIssueDraft,
};
