const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const settingService = require('./setting.service');

/**
 * Generate a unique Document Number
 */
const generateDocumentNo = async (tenantId, movementType, db = prisma) => {
    const prefixMap = {
        OPENING_BALANCE: 'OB',
        RECEIVE: 'REC',
        ISSUE: 'ISS',
        TRANSFER_OUT: 'TRO',
        TRANSFER_IN: 'TRI',
        RETURN: 'RET',
        ADJUSTMENT: 'ADJ',
        BREAKAGE: 'BRK',
        COUNT_ADJUSTMENT: 'CNT'
    };

    const prefix = prefixMap[movementType] || 'MOV';
    const yearMonth = new Date().toISOString().slice(2, 7).replace('-', ''); // e.g., 2602 for Feb 2026

    const startStr = `${prefix}-${yearMonth}-`;

    const lastDoc = await db.movementDocument.findFirst({
        where: {
            tenantId,
            documentNo: { startsWith: startStr }
        },
        orderBy: { documentNo: 'desc' }
    });

    let seqNum = 1;
    if (lastDoc) {
        const parts = lastDoc.documentNo.split('-');
        if (parts.length === 3) {
            seqNum = parseInt(parts[2], 10) + 1;
        }
    }

    return `${startStr}${seqNum.toString().padStart(4, '0')}`;
};

/**
 * Create a new draft movement document
 */
const createMovementDraft = async (data, tenantId, userId, db = prisma) => {
    // ── Phase 4 MANDATORY GUARD: No manual RECEIVE without a valid GRN ──────
    // Every RECEIVE movement MUST reference an approved GRN.
    // This is a strict control requirement — no exceptions.
    if (data.movementType === 'RECEIVE') {
        if (!data.grnImportId) {
            const err = new Error('Direct RECEIVE movements are not allowed. All stock receipts must go through an approved GRN.');
            err.statusCode = 403;
            throw err;
        }
        const grn = await db.grnImport.findFirst({
            where: { id: data.grnImportId, tenantId },
        });
        if (!grn) {
            const err = new Error('Referenced GRN not found.');
            err.statusCode = 404;
            throw err;
        }
        if (grn.status !== 'APPROVED') {
            const err = new Error(`Referenced GRN must be in APPROVED status. Current status: ${grn.status}`);
            err.statusCode = 403;
            throw err;
        }
    }
    // ────────────────────────────────────────────────────────────────────────

    // ── Phase 5 MANDATORY GUARD: No manual ISSUE without an approved Requisition ──
    if (data.movementType === 'ISSUE') {
        if (!data.requisitionId) {
            const err = new Error('Direct ISSUE movements are not allowed. All stock issues must reference an approved Store Requisition.');
            err.statusCode = 403;
            throw err;
        }
        const reqn = await db.storeRequisition.findFirst({
            where: { id: data.requisitionId, tenantId },
        });
        if (!reqn) {
            const err = new Error('Referenced Requisition not found.');
            err.statusCode = 404;
            throw err;
        }
        if (!['APPROVED', 'PARTIALLY_ISSUED'].includes(reqn.status)) {
            const err = new Error(`Referenced Requisition must be APPROVED or PARTIALLY_ISSUED. Current status: ${reqn.status}`);
            err.statusCode = 403;
            throw err;
        }
    }
    // ────────────────────────────────────────────────────────────────────────

    // ── Phase 6 MANDATORY GUARD: No manual TRANSFER_OUT / TRANSFER_IN ─────────
    if (data.movementType === 'TRANSFER_OUT') {
        const err = new Error('Direct TRANSFER_OUT movements are not allowed. Use the Transfer Control Gate (/api/transfers/:id/dispatch).');
        err.statusCode = 403;
        throw err;
    }
    if (data.movementType === 'TRANSFER_IN') {
        const err = new Error('Direct TRANSFER_IN movements are not allowed. TRANSFER_IN is posted automatically when a transfer is received (/api/transfers/:id/receive).');
        err.statusCode = 403;
        throw err;
    }
    // ────────────────────────────────────────────────────────────────────────

    const documentNo = await generateDocumentNo(tenantId, data.movementType, db);


    // Sanitize optional UUID fields — convert empty strings to null
    const sanitizeUuid = (val) => (val && val.trim() !== '' ? val : null);
    data.sourceLocationId = sanitizeUuid(data.sourceLocationId);
    data.destLocationId = sanitizeUuid(data.destLocationId);
    data.supplierId = sanitizeUuid(data.supplierId);

    // Validate locations if provided
    if (data.sourceLocationId) {
        const source = await db.location.findFirst({ where: { id: data.sourceLocationId, tenantId } });
        if (!source) throw Object.assign(new Error('Source location not found'), { statusCode: 404 });
    }

    if (data.destLocationId) {
        const dest = await db.location.findFirst({ where: { id: data.destLocationId, tenantId } });
        if (!dest) throw Object.assign(new Error('Destination location not found'), { statusCode: 404 });
    }

    // Determine the default location for lines from the header
    const defaultLocationId = data.destLocationId || data.sourceLocationId || null;

    /** OPENING_BALANCE drafts: line `unitCost` / `totalValue` follow catalog `unitPrice` (single source). */
    let obCatalogPrices = null;
    if (data.movementType === 'OPENING_BALANCE' && data.lines?.length > 0) {
        const itemIds = [...new Set(data.lines.map((l) => l.itemId).filter(Boolean))];
        if (itemIds.length > 0) {
            const items = await db.item.findMany({
                where: { id: { in: itemIds }, tenantId },
                select: { id: true, unitPrice: true },
            });
            obCatalogPrices = new Map(items.map((it) => [it.id, Number(it.unitPrice ?? 0)]));
        }
    }

    // Build line items for nested create
    const linesCreate = (data.lines && data.lines.length > 0)
        ? {
            create: data.lines.map(line => {
                const lineLocationId = (line.locationId && line.locationId.trim() !== '')
                    ? line.locationId
                    : defaultLocationId;

                if (!lineLocationId) {
                    throw Object.assign(
                        new Error('A location is required. Please select a location on the document header.'),
                        { statusCode: 400 }
                    );
                }

                const qtyInput =
                    line.qtyRequested !== undefined && line.qtyRequested !== null
                        ? line.qtyRequested
                        : line.quantity;
                const qtyReq = parseFloat(qtyInput) || 0;
                let unitCost = parseFloat(line.unitCost) || 0;
                let totalValue = parseFloat(line.totalValue) || 0;
                if (data.movementType === 'OPENING_BALANCE' && obCatalogPrices) {
                    const cat = obCatalogPrices.get(line.itemId);
                    if (cat !== undefined && cat > 0) {
                        unitCost = cat;
                        totalValue = qtyReq * unitCost;
                    }
                }

                return {
                    item: { connect: { id: line.itemId } },
                    location: { connect: { id: lineLocationId } },
                    qtyRequested: qtyReq,
                    qtyInBaseUnit: qtyReq,
                    unitCost,
                    totalValue,
                    notes: line.notes || null
                };
            })
        }
        : undefined;

    // Remove lines and other non-Prisma fields from the root data
    const { lines, referenceNumber, ...headerData } = data;

    const documentData = {
        ...headerData,
        documentNo,
        documentDate: new Date(data.documentDate || new Date()),
        status: 'DRAFT',
        createdBy: userId,
        tenantId,
        ...(linesCreate && { lines: linesCreate })
    };

    return db.movementDocument.create({
        data: documentData,
        include: {
            lines: { include: { item: { select: { name: true, barcode: true } } } },
            createdByUser: { select: { firstName: true, lastName: true } }
        }
    });
};

/**
 * Get movement documents (List)
 */
const getMovements = async (tenantId, query) => {
    const obStatus = await settingService.getObStatus(tenantId);
    if (obStatus !== 'FINALIZED') {
        return {
            documents: [],
            total: 0,
            status: 'SETUP_IN_PROGRESS',
            obStatus,
        };
    }

    const { skip = 0, take = 10, status, movementType, search, sourceType } = query;

    const sourceFilter =
        sourceType === 'INTERNAL'
            ? { getPassId: null }
            : sourceType === 'GET_PASS_RETURN'
                ? { getPassId: { not: null } }
                : {};

    const where = {
        tenantId,
        ...(status && { status }),
        ...(movementType && { movementType }),
        ...sourceFilter,
        ...(search && {
            OR: [
                { documentNo: { contains: search, mode: 'insensitive' } },
                { department: { contains: search, mode: 'insensitive' } },
                { notes: { contains: search, mode: 'insensitive' } }
            ]
        })
    };

    const [documents, total] = await Promise.all([
        prisma.movementDocument.findMany({
            where,
            skip: parseInt(skip),
            take: parseInt(take),
            orderBy: { documentDate: 'desc' },
            include: {
                createdByUser: { select: { firstName: true, lastName: true } },
                getPass: { select: { id: true, passNo: true } },
                _count: { select: { lines: true } }
            }
        }),
        prisma.movementDocument.count({ where })
    ]);

    return { documents, total };
};

/**
 * Get specific movement document details
 */
const getMovementById = async (id, tenantId) => {
    const obStatus = await settingService.getObStatus(tenantId);
    if (obStatus !== 'FINALIZED') {
        const error = new Error('Stock movements are unavailable while opening balance setup is in progress.');
        error.statusCode = 409;
        error.code = 'SETUP_IN_PROGRESS';
        error.details = { obStatus };
        throw error;
    }

    const document = await prisma.movementDocument.findFirst({
        where: { id, tenantId },
        include: {
            lines: {
                include: {
                    item: { select: { name: true, barcode: true, unitPrice: true } },
                    location: { select: { name: true } }
                }
            },
            createdByUser: { select: { firstName: true, lastName: true } }
        }
    });

    if (!document) {
        const error = new Error('Movement document not found');
        error.statusCode = 404;
        throw error;
    }

    return document;
};

/**
 * Update a DRAFT movement document
 */
const updateMovementDraft = async (id, data, tenantId) => {
    const document = await getMovementById(id, tenantId);

    if (document.status !== 'DRAFT' && document.status !== 'REJECTED') {
        const error = new Error(`Cannot update document in ${document.status} status`);
        error.statusCode = 400;
        throw error;
    }

    // Handling full replacement of lines if provided
    if (data.lines) {
        // Determine fallback location from header
        const headerDefault = data.destLocationId || data.sourceLocationId || null;

        await prisma.$transaction(async (tx) => {
            // Delete existing lines
            await tx.movementLine.deleteMany({ where: { documentId: id } });

            // Create new lines
            if (data.lines.length > 0) {
                let obCatalogPrices = null;
                if (document.movementType === 'OPENING_BALANCE') {
                    const itemIds = [...new Set(data.lines.map((l) => l.itemId).filter(Boolean))];
                    if (itemIds.length > 0) {
                        const items = await tx.item.findMany({
                            where: { id: { in: itemIds }, tenantId },
                            select: { id: true, unitPrice: true },
                        });
                        obCatalogPrices = new Map(items.map((it) => [it.id, Number(it.unitPrice ?? 0)]));
                    }
                }

                const linesToInsert = data.lines.map(line => {
                    const lineLocationId = (line.locationId && line.locationId.trim() !== '')
                        ? line.locationId
                        : headerDefault;

                    if (!lineLocationId) {
                        throw Object.assign(
                            new Error('A location is required. Please select a location on the document header.'),
                            { statusCode: 400 }
                        );
                    }

                    const qtyInput =
                        line.qtyRequested !== undefined && line.qtyRequested !== null
                            ? line.qtyRequested
                            : line.quantity;
                    const qtyReq = parseFloat(qtyInput) || 0;
                    let unitCost = parseFloat(line.unitCost) || 0;
                    let totalValue = parseFloat(line.totalValue) || 0;
                    if (obCatalogPrices) {
                        const cat = obCatalogPrices.get(line.itemId);
                        if (cat !== undefined && cat > 0) {
                            unitCost = cat;
                            totalValue = qtyReq * unitCost;
                        }
                    }

                    return {
                        documentId: id,
                        itemId: line.itemId,
                        locationId: lineLocationId,
                        qtyRequested: qtyReq,
                        qtyInBaseUnit: qtyReq,
                        unitCost,
                        totalValue,
                        notes: line.notes
                    };
                });
                await tx.movementLine.createMany({ data: linesToInsert });
            }
        });
    }

    // Remove lines from root before main update
    const { lines, ...mainData } = data;

    // Ensure documentDate is a proper Date object if present
    if (mainData.documentDate) {
        mainData.documentDate = new Date(mainData.documentDate);
    }

    if (Object.keys(mainData).length > 0) {
        return prisma.movementDocument.update({
            where: { id },
            data: mainData,
            include: {
                lines: { include: { item: { select: { name: true } } } }
            }
        });
    }

    // Re-fetch to return latest data if only lines were updated
    return getMovementById(id, tenantId);
};

module.exports = {
    createMovementDraft,
    getMovements,
    getMovementById,
    updateMovementDraft
};
