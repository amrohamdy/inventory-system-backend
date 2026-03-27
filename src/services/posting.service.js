const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const movementService = require('./movement.service');
const { checkPeriodLock, checkOBAllowed } = require('./periodGuard.service');
const { logAction, EntityType } = require('./auditTrail.service');
const { generateDocNumber, prefixFromMovementType } = require('./docNumbering.service');

/**
 * Core engine for posting stock movements to the ledger and updating balances.
 * Uses a database transaction to ensure atomicity.
 */
const postDocument = async (documentId, tenantId, userId) => {
    // 1. Fetch document and validate status
    const document = await movementService.getMovementById(documentId, tenantId);

    if (!document) {
        const error = new Error('Document not found');
        error.statusCode = 404;
        throw error;
    }

    if (document.status !== 'DRAFT') {
        const error = new Error(`Cannot post a document with status ${document.status}`);
        error.statusCode = 400;
        throw error;
    }

    if (document.lines.length === 0) {
        const error = new Error('Cannot post an empty document');
        error.statusCode = 400;
        throw error;
    }

    // ── Period Guard ─────────────────────────────────────────────────────────
    const txDate = document.documentDate || new Date();
    await checkPeriodLock(tenantId, txDate);
    if (document.movementType === 'OPENING_BALANCE') {
        await checkOBAllowed(tenantId);

        // ── Zero-Cost Guard ──────────────────────────────────────────────────
        // Opening Balance without a unit cost produces WAC = 0 and breaks
        // Valuation and OMC reports. Every OB line must have unitCost > 0.
        const zeroCostLines = document.lines.filter(l => !(Number(l.unitCost) > 0));
        if (zeroCostLines.length > 0) {
            const names = zeroCostLines.map(l => l.item?.name || l.itemId).join(', ');
            throw Object.assign(
                new Error(`Opening Balance requires a valid unit cost for every line. Missing cost for: ${names}`),
                { statusCode: 400, code: 'OB_ZERO_COST' }
            );
        }
        // ─────────────────────────────────────────────────────────────────────
    }
    // ─────────────────────────────────────────────────────────────────────────

    // 2. Perform the Transaction
    const result = await prisma.$transaction(async (tx) => {
        // ============================================================================
        // 🚨 ARCHITECTURAL GUARD: STRICT LEDGER CONSISTENCY RULE 🚨
        // `StockBalance` must NEVER be mutated outside of this engine.
        // Every `tx.stockBalance.update/upsert` MUST be paired with a corresponding
        // `tx.inventoryLedger.create` entry within this exact same database transaction.
        // Bypassing this rule will break OMC (Opening-Movement-Closing) reconciliation.
        // ============================================================================

        // Process each line in the document
        for (const line of document.lines) {
            const { itemId, qtyInBaseUnit, unitCost, totalValue } = line;
            const qty = Number(qtyInBaseUnit);

            // Determine Action and Locations based on MovementType
            let sourceLocationId = document.sourceLocationId || line.locationId;
            let destLocationId = document.destLocationId || line.locationId;

            const isIncrease = ['OPENING_BALANCE', 'RECEIVE', 'TRANSFER_IN', 'RETURN'].includes(document.movementType);
            const isDecrease = ['ISSUE', 'TRANSFER_OUT', 'BREAKAGE'].includes(document.movementType);
            const isTransfer = document.movementType === 'TRANSFER'; // Generic transfer if combined
            const isAdjustment = ['ADJUSTMENT', 'COUNT_ADJUSTMENT'].includes(document.movementType);

            // -- A. Decrement Stock (Source) --
            if (isDecrease || document.movementType === 'TRANSFER') {
                // Fetch current stock
                const currentStock = await tx.stockBalance.findUnique({
                    where: {
                        tenantId_itemId_locationId: {
                            tenantId,
                            itemId,
                            locationId: sourceLocationId
                        }
                    }
                });

                if (!currentStock || Number(currentStock.qtyOnHand) < qty) {
                    throw new Error(`Insufficient stock for Item ${line.item.name} at source location. Available: ${currentStock ? currentStock.qtyOnHand : 0}, Requested: ${qty}`);
                }

                // Create Ledger Entry for Issue
                await tx.inventoryLedger.create({
                    data: {
                        tenantId,
                        itemId,
                        locationId: sourceLocationId,
                        movementType: document.movementType === 'TRANSFER' ? 'TRANSFER_OUT' : document.movementType,
                        qtyOut: qty,
                        qtyIn: 0,
                        unitCost: currentStock.wacUnitCost, // Outgoing at current WAC
                        totalValue: qty * Number(currentStock.wacUnitCost),
                        referenceType: 'MOVEMENT',
                        referenceId: document.id,
                        referenceNo: document.documentNo,
                        createdBy: userId
                    }
                });

                // Update Stock Balance
                await tx.stockBalance.update({
                    where: {
                        tenantId_itemId_locationId: {
                            tenantId,
                            itemId,
                            locationId: sourceLocationId
                        }
                    },
                    data: {
                        qtyOnHand: { decrement: qty }
                        // WAC doesn't change on issue
                    }
                });
            }

            // -- B. Increment Stock (Destination) --
            if (isIncrease || document.movementType === 'TRANSFER') {
                const destLoc = isTransfer ? destLocationId : sourceLocationId;

                // Fetch current stock to calculate new WAC
                const currentStock = await tx.stockBalance.findUnique({
                    where: {
                        tenantId_itemId_locationId: { tenantId, itemId, locationId: destLoc }
                    }
                });

                const currentQty = currentStock ? Number(currentStock.qtyOnHand) : 0;
                const currentWac = currentStock ? Number(currentStock.wacUnitCost) : 0;

                // Cost used for the new receipt
                const receiveUnitCost = Number(unitCost) > 0 ? Number(unitCost) : currentWac;
                const receiveTotalValue = Number(totalValue) > 0 ? Number(totalValue) : (qty * receiveUnitCost);

                // Calculate new WAC
                const totalValueBefore = currentQty * currentWac;
                const newTotalQty = currentQty + qty;
                const newWac = newTotalQty > 0 ? ((totalValueBefore + receiveTotalValue) / newTotalQty) : 0;

                // Create Ledger Entry for Receipt
                await tx.inventoryLedger.create({
                    data: {
                        tenantId,
                        itemId,
                        locationId: destLoc,
                        movementType: document.movementType === 'TRANSFER' ? 'TRANSFER_IN' : document.movementType,
                        qtyIn: qty,
                        qtyOut: 0,
                        unitCost: receiveUnitCost,
                        totalValue: receiveTotalValue,
                        referenceType: 'MOVEMENT',
                        referenceId: document.id,
                        referenceNo: document.documentNo,
                        createdBy: userId
                    }
                });

                // Upsert Stock Balance
                await tx.stockBalance.upsert({
                    where: {
                        tenantId_itemId_locationId: { tenantId, itemId, locationId: destLoc }
                    },
                    update: {
                        qtyOnHand: { increment: qty },
                        wacUnitCost: newWac
                    },
                    create: {
                        tenantId,
                        itemId,
                        locationId: destLoc,
                        qtyOnHand: qty,
                        wacUnitCost: receiveUnitCost
                    }
                });
            }

            // -- C. Adjustments (Positive or Negative handled dynamically) --
            if (isAdjustment) {
                const adjLocationId = sourceLocationId || line.locationId;
                const isPositive = qty >= 0;
                const absQty = Math.abs(qty);

                // Fetch current WAC to value the adjustment
                const currentStock = await tx.stockBalance.findUnique({
                    where: { tenantId_itemId_locationId: { tenantId, itemId, locationId: adjLocationId } }
                });

                const currentWac = currentStock ? Number(currentStock.wacUnitCost) : Number(unitCost) || 0;
                const adjUnitCost = Number(unitCost) > 0 ? Number(unitCost) : currentWac;
                const adjTotalValue = absQty * adjUnitCost;

                // Create Ledger Entry
                await tx.inventoryLedger.create({
                    data: {
                        tenantId,
                        itemId,
                        locationId: adjLocationId,
                        movementType: document.movementType,
                        qtyIn: isPositive ? absQty : 0,
                        qtyOut: isPositive ? 0 : absQty,
                        unitCost: adjUnitCost,
                        totalValue: adjTotalValue,
                        referenceType: 'MOVEMENT',
                        referenceId: document.id,
                        referenceNo: document.documentNo,
                        createdBy: userId
                    }
                });

                if (isPositive) {
                    // Increase balance (upsert in case balance doesn't exist yet)
                    const currentQty = currentStock ? Number(currentStock.qtyOnHand) : 0;
                    const newTotalQty = currentQty + absQty;
                    const newWac = newTotalQty > 0
                        ? ((currentQty * currentWac) + adjTotalValue) / newTotalQty
                        : adjUnitCost;

                    await tx.stockBalance.upsert({
                        where: { tenantId_itemId_locationId: { tenantId, itemId, locationId: adjLocationId } },
                        update: { qtyOnHand: { increment: absQty }, wacUnitCost: newWac },
                        create: { tenantId, itemId, locationId: adjLocationId, qtyOnHand: absQty, wacUnitCost: adjUnitCost }
                    });
                } else {
                    // Decrease balance — check sufficient stock first
                    if (!currentStock || Number(currentStock.qtyOnHand) < absQty) {
                        throw new Error(`Insufficient stock for adjustment of ${line.item.name}. Available: ${currentStock ? currentStock.qtyOnHand : 0}, Requested: ${absQty}`);
                    }
                    await tx.stockBalance.update({
                        where: { tenantId_itemId_locationId: { tenantId, itemId, locationId: adjLocationId } },
                        data: { qtyOnHand: { decrement: absQty } }
                    });
                }
            }
        }

        // 3. Mark Document as POSTED + assign refNumber
        const prefix = prefixFromMovementType(document.movementType);
        const refNumber = await generateDocNumber(tenantId, prefix, document.documentDate || new Date());

        const updatedDocument = await tx.movementDocument.update({
            where: { id: documentId },
            data: {
                status: 'POSTED',
                postedAt: new Date(),
                documentNo: document.documentNo || refNumber, // keep existing if already set
            }
        });

        // 4. Auto-lock Opening Balance if this is a non-OB movement
        if (document.movementType !== 'OPENING_BALANCE') {
            await tx.tenantSetting.upsert({
                where: { tenantId_key: { tenantId, key: 'allowOpeningBalance' } },
                update: {
                    value: 'LOCKED',
                    reason: `Auto-locked: ${document.movementType} posted (${document.documentNo})`,
                },
                create: {
                    tenantId,
                    key: 'allowOpeningBalance',
                    value: 'LOCKED',
                    reason: `Auto-locked: first non-OB posting (${document.documentNo})`,
                },
            });
        }

        return updatedDocument;

    }); // End Transaction

    // Audit trail — outside transaction so a log failure never rolls back the posting
    await logAction({
        tenantId,
        entityType: EntityType.MOVEMENT,
        entityId: documentId,
        action: 'POST',
        changedBy: userId,
        note: `${document.movementType} posted (${result.documentNo || documentId})`,
    });

    return result;
};

/**
 * M10: Engine for posting Stock Count adjustments to the ledger.
 */
const postStockCount = async (sessionId, tenantId, userId) => {
    const session = await prisma.stockCountSession.findUnique({
        where: { id: sessionId, tenantId },
        include: { lines: true }
    });

    if (!session) throw new Error('Session not found');
    if (session.status === 'POSTED') throw new Error('Session is already POSTED');

    // ── Period Guard ─────────────────────────────────────────────────────────
    await checkPeriodLock(tenantId, session.countDate || session.createdAt);
    // ─────────────────────────────────────────────────────────────────────────

    const result = await prisma.$transaction(async (tx) => {
        // ============================================================================
        // 🚨 ARCHITECTURAL GUARD: STRICT LEDGER CONSISTENCY RULE 🚨
        // `StockBalance` must NEVER be mutated independently.
        // Every adjustment MUST have a parallel `COUNT_ADJUSTMENT` ledger entry.
        // ============================================================================

        for (const line of session.lines) {
            const varianceQty = Number(line.varianceQty);
            if (varianceQty === 0) continue; // No adjustment needed

            const isPositive = varianceQty > 0;
            const absVariance = Math.abs(varianceQty);
            const wac = Number(line.wacUnitCost);
            const totalValue = Math.abs(Number(line.varianceValue));

            // Create Ledger Entry
            await tx.inventoryLedger.create({
                data: {
                    tenantId,
                    itemId: line.itemId,
                    locationId: session.locationId,
                    movementType: 'COUNT_ADJUSTMENT',
                    qtyIn: isPositive ? absVariance : 0,
                    qtyOut: isPositive ? 0 : absVariance,
                    unitCost: wac,
                    totalValue: totalValue,
                    referenceType: 'STOCK_COUNT',
                    referenceId: session.id,
                    referenceNo: session.sessionNo,
                    approvalId: session.approvalRequestId,
                    createdBy: userId
                }
            });

            // Update Stock Balance
            // Usually, WAC is re-calculated for POSITIVE variances on RECEIPT.
            // For stock count, we typically value found items at current WAC to prevent distortion,
            // meaning WAC stays unchanged either way, we just increment qty.
            if (isPositive) {
                // Upsert to handle rare case where item wasn't in balance before, though createSession guarantees it
                await tx.stockBalance.upsert({
                    where: { tenantId_itemId_locationId: { tenantId, itemId: line.itemId, locationId: session.locationId } },
                    update: { qtyOnHand: { increment: absVariance } },
                    create: { tenantId, itemId: line.itemId, locationId: session.locationId, qtyOnHand: absVariance, wacUnitCost: wac }
                });
            } else {
                // Negative variance
                await tx.stockBalance.update({
                    where: { tenantId_itemId_locationId: { tenantId, itemId: line.itemId, locationId: session.locationId } },
                    data: { qtyOnHand: { decrement: absVariance } }
                });
            }
        }

        const updatedSession = await tx.stockCountSession.update({
            where: { id: sessionId },
            data: { status: 'POSTED', postedAt: new Date() }
        });

        // Auto-lock Opening Balance on stock count posting
        await tx.tenantSetting.upsert({
            where: { tenantId_key: { tenantId, key: 'allowOpeningBalance' } },
            update: {
                value: 'LOCKED',
                reason: `Auto-locked: COUNT_ADJUSTMENT posted (${session.sessionNo})`,
            },
            create: {
                tenantId,
                key: 'allowOpeningBalance',
                value: 'LOCKED',
                reason: `Auto-locked: COUNT_ADJUSTMENT posted (${session.sessionNo})`,
            },
        });

        return updatedSession;
    });

    return result;
};

/**
 * M13: Engine for posting Approved Stock Reports (SavedStockReport) to the ledger
 * and updating stock balances. Iterates per-location variances from SavedStockReportLocationQty.
 */
const postStockReport = async (reportId, tenantId, userId) => {
    const report = await prisma.savedStockReport.findUnique({
        where: { id: reportId, tenantId },
        include: {
            lines: {
                include: { locationQtys: true }
            }
        }
    });

    if (!report) throw new Error('Stock Report not found');
    if (report.status === 'POSTED') throw new Error('Stock Report is already POSTED');

    // ── Period Guard ─────────────────────────────────────────────────────────
    const reportDate = report.createdAt || new Date();
    await checkPeriodLock(tenantId, reportDate);
    // ─────────────────────────────────────────────────────────────────────────

    const result = await prisma.$transaction(async (tx) => {
        // ============================================================================
        // 🚨 ARCHITECTURAL GUARD: STRICT LEDGER CONSISTENCY RULE 🚨
        // Iterate over each item line, and for each sub-location qty entry that has
        // a non-zero variance, create a ledger entry and adjust stock balance.
        // ============================================================================

        for (const line of report.lines) {
            for (const locQty of line.locationQtys) {
                const varianceQty = Number(locQty.varianceQty);
                if (varianceQty === 0) continue; // No adjustment for this location

                const locationId = locQty.locationId;
                const isPositive = varianceQty > 0;
                const absVariance = Math.abs(varianceQty);

                // Re-fetch current WAC since it might have changed since the draft was created
                const currentStock = await tx.stockBalance.findUnique({
                    where: { tenantId_itemId_locationId: { tenantId, itemId: line.itemId, locationId } }
                });
                const wac = currentStock ? Number(currentStock.wacUnitCost) : 0;
                const adjustedTotalValue = absVariance * wac;

                // Create Ledger Entry for this item+location variance
                await tx.inventoryLedger.create({
                    data: {
                        tenantId,
                        itemId: line.itemId,
                        locationId,
                        movementType: 'COUNT_ADJUSTMENT',
                        qtyIn: isPositive ? absVariance : 0,
                        qtyOut: isPositive ? 0 : absVariance,
                        unitCost: wac,
                        totalValue: adjustedTotalValue,
                        referenceType: 'STOCK_REPORT',
                        referenceId: report.id,
                        referenceNo: report.reportNo,
                        approvalId: report.approvalRequestId || null,
                        createdBy: userId
                    }
                });

                // Update Stock Balance for this item+location
                if (isPositive) {
                    await tx.stockBalance.upsert({
                        where: { tenantId_itemId_locationId: { tenantId, itemId: line.itemId, locationId } },
                        update: { qtyOnHand: { increment: absVariance } },
                        create: { tenantId, itemId: line.itemId, locationId, qtyOnHand: absVariance, wacUnitCost: wac }
                    });
                } else {
                    // Use updateMany to avoid P2025 error if balance record doesn't exist
                    await tx.stockBalance.updateMany({
                        where: { tenantId, itemId: line.itemId, locationId },
                        data: { qtyOnHand: { decrement: absVariance } }
                    });
                }
            }
        }

        const updatedReport = await tx.savedStockReport.update({
            where: { id: reportId },
            data: { status: 'POSTED', postedAt: new Date() }
        });

        // Auto-lock Opening Balance on stock count posting
        await tx.tenantSetting.upsert({
            where: { tenantId_key: { tenantId, key: 'allowOpeningBalance' } },
            update: {
                value: 'LOCKED',
                reason: `Auto-locked: COUNT_ADJUSTMENT posted via Stock Report (${report.reportNo})`,
            },
            create: {
                tenantId,
                key: 'allowOpeningBalance',
                value: 'LOCKED',
                reason: `Auto-locked: COUNT_ADJUSTMENT posted via Stock Report (${report.reportNo})`,
            },
        });

        return updatedReport;

    });

    return result;
};

module.exports = {
    postDocument,
    postStockCount,
    postStockReport
};
