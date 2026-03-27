'use strict';
const { PrismaClient } = require('@prisma/client');
const ExcelJS = require('exceljs');
const pdfParse = require('pdf-parse');
const fs = require('fs');
const prisma = new PrismaClient();
const emailService = require('./email.service');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const assertStatus = async (grnId, tenantId, expected) => {
    const grn = await prisma.grnImport.findFirst({ where: { id: grnId, tenantId } });
    if (!grn) throw Object.assign(new Error('GRN not found'), { status: 404 });
    if (grn.status !== expected)
        throw Object.assign(
            new Error(`GRN must be in ${expected} status, currently ${grn.status}`),
            { status: 422 }
        );
    return grn;
};

// ─── Create GRN ──────────────────────────────────────────────────────────────

/**
 * Create a new GRN with validated items from the Item Master.
 * Items and supplier must already exist — no mapping needed.
 *
 * @param {object} opts
 * @param {string} opts.supplierId      — must exist in suppliers table
 * @param {string} opts.locationId      — destination warehouse
 * @param {string} opts.grnNumber       — external GRN / invoice number
 * @param {Date}   opts.receivingDate
 * @param {string} opts.invoiceUrl      — mandatory invoice file path
 * @param {string} [opts.notes]
 * @param {Array}  opts.lines           — [{ itemId, uomId, orderedQty, receivedQty, unitPrice, notes? }]
 * @param {string} opts.tenantId
 * @param {string} opts.userId
 */
const createGrn = async ({
    supplierId, locationId, grnNumber, receivingDate,
    invoiceUrl, notes, lines, tenantId, userId,
}) => {
    // ── Validate supplier ──
    const supplier = await prisma.supplier.findFirst({
        where: { id: supplierId, tenantId },
    });
    if (!supplier)
        throw Object.assign(new Error('Supplier not found. Make sure the supplier exists in the system first.'), { status: 404 });

    // ── Validate location ──
    const location = await prisma.location.findFirst({
        where: { id: locationId, tenantId },
    });
    if (!location)
        throw Object.assign(new Error('Warehouse/Location not found.'), { status: 404 });

    // ── Duplicate GRN number check ──
    const existing = await prisma.grnImport.findUnique({
        where: { tenantId_grnNumber: { tenantId, grnNumber } },
    });
    if (existing)
        throw Object.assign(new Error(`GRN number "${grnNumber}" already exists.`), { status: 409 });

    // ── Validate all items exist ──
    if (!lines || lines.length === 0)
        throw Object.assign(new Error('At least one line item is required.'), { status: 400 });

    const itemIds = [...new Set(lines.map(l => l.itemId))];
    const foundItems = await prisma.item.findMany({
        where: { id: { in: itemIds }, tenantId },
        include: { itemUnits: { include: { unit: true } } },
    });
    const foundItemIds = new Set(foundItems.map(i => i.id));
    const missingIds = itemIds.filter(id => !foundItemIds.has(id));
    if (missingIds.length > 0)
        throw Object.assign(
            new Error(`${missingIds.length} item(s) not found in Item Master. Add them first.`),
            { status: 422, details: missingIds }
        );

    // ── Validate each line qty ──
    const invalidLines = lines.filter(l => Number(l.receivedQty) <= 0);
    if (invalidLines.length > 0)
        throw Object.assign(new Error('All received quantities must be greater than zero.'), { status: 400 });

    // ── Build item lookup for display ──
    const itemMap = Object.fromEntries(foundItems.map(i => [i.id, i]));

    // ── Create GRN atomically ──
    const grn = await prisma.grnImport.create({
        data: {
            tenantId,
            grnNumber,
            vendorId: supplierId,
            vendorNameSnapshot: supplier.name,
            locationId,
            receivingDate: receivingDate ? new Date(receivingDate) : new Date(),
            pdfAttachmentUrl: invoiceUrl,
            notes: notes || null,
            status: 'DRAFT',
            importedBy: userId,
            lines: {
                create: lines.map(l => ({
                    futurelogItemCode: itemMap[l.itemId]?.barcode || l.itemId,
                    futurelogDescription: itemMap[l.itemId]?.name || '',
                    futurelogUom: l.uomId,  // store uomId here for now
                    orderedQty: Number(l.orderedQty) || 0,
                    receivedQty: Number(l.receivedQty),
                    unitPrice: Number(l.unitPrice) || 0,
                    internalItemId: l.itemId,
                    internalUomId: l.uomId,
                    conversionFactor: 1,
                    qtyInBaseUnit: Number(l.receivedQty),
                    isMapped: true,  // always true — items pre-validated
                    // notes per line stored in futurelogDescription + custom notes if exists
                })),
            },
        },
        include: {
            lines: true,
            vendor: { select: { name: true } },
            location: { select: { name: true } },
        },
    });

    return grn;
};

// ─── State Machine ────────────────────────────────────────────────────────────

/**
 * Validate: supplier resolved, invoice attached, all lines mapped.
 * With new design all lines are always mapped on creation, so this is fast.
 */
const validateGrn = async (grnId, tenantId) => {
    const grn = await prisma.grnImport.findFirst({
        where: { id: grnId, tenantId },
        include: { lines: true },
    });
    if (!grn) throw Object.assign(new Error('GRN not found'), { status: 404 });

    const LOCKED = ['VALIDATED', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'REJECTED'];
    if (LOCKED.includes(grn.status))
        throw Object.assign(
            new Error(`GRN is in ${grn.status} status and cannot be re-validated.`),
            { status: 422 }
        );

    const errors = [];
    if (!grn.vendorId) errors.push('Supplier is not set.');
    if (!grn.pdfAttachmentUrl) errors.push('Invoice attachment is required before validation.');
    const unmapped = grn.lines.filter(l => !l.isMapped);
    if (unmapped.length > 0) errors.push(`${unmapped.length} line(s) missing item mapping.`);

    if (errors.length > 0)
        throw Object.assign(new Error(errors.join(' | ')), { status: 422, details: errors });

    return prisma.grnImport.update({
        where: { id: grnId },
        data: { status: 'VALIDATED', updatedAt: new Date() },
    });
};

const submitForApproval = async (grnId, tenantId, userId) => {
    await assertStatus(grnId, tenantId, 'VALIDATED');
    const grn = await prisma.grnImport.update({
        where: { id: grnId },
        data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
    });

    // Simulate approval logic integration
    // Finding admin/manager for email
    try {
        const approvers = await prisma.tenantMember.findMany({
            where: { tenantId, role: { in: ['ADMIN'] }, isActive: true, user: { isActive: true } },
            select: { user: { select: { email: true } } }
        });
        const submitter = await prisma.user.findUnique({ where: { id: userId } });

        // Mock a pseudo-approval object
        const pseudoApproval = {
            type: 'GRN',
            createdAt: grn.createdAt,
            notes: `GRN Number: ${grn.grnNumber}`
        };
        for (const app of approvers) {
            await emailService.sendApprovalPendingNotification(pseudoApproval, submitter, app.user.email);
        }
    } catch (err) {
        console.error("Failed to send GRN approval email", err);
    }
    return grn;
};

const approveGrn = async (grnId, tenantId, userId, comment) => {
    await assertStatus(grnId, tenantId, 'PENDING_APPROVAL');
    return prisma.grnImport.update({
        where: { id: grnId },
        data: { status: 'APPROVED', approvedBy: userId, updatedAt: new Date() },
    });
};

const rejectGrn = async (grnId, tenantId, userId, reason) => {
    const grn = await prisma.grnImport.findFirst({ where: { id: grnId, tenantId } });
    if (!grn) throw Object.assign(new Error('GRN not found'), { status: 404 });
    if (!['PENDING_APPROVAL', 'VALIDATED', 'DRAFT'].includes(grn.status))
        throw Object.assign(new Error('GRN cannot be rejected in its current state'), { status: 422 });
    return prisma.grnImport.update({
        where: { id: grnId },
        data: { status: 'REJECTED', rejectedBy: userId, rejectionReason: reason, updatedAt: new Date() },
    });
};

// ─── Post GRN (Atomic) ───────────────────────────────────────────────────────

/**
 * ATOMIC: Post all GRN lines to InventoryLedger + update StockBalance + WAC.
 */
const postGrn = async (grnId, tenantId, userId) => {
    const grn = await prisma.grnImport.findFirst({
        where: { id: grnId, tenantId },
        include: { lines: true },
    });
    if (!grn) throw Object.assign(new Error('GRN not found'), { status: 404 });
    if (grn.status !== 'APPROVED')
        throw Object.assign(new Error('GRN must be APPROVED before posting'), { status: 422 });

    await prisma.$transaction(async (tx) => {
        for (const line of grn.lines) {
            if (!line.internalItemId || !line.internalUomId)
                throw new Error(`Line is missing item or UOM — aborting post`);

            const qtyToPost = Number(line.qtyInBaseUnit);
            if (qtyToPost <= 0)
                throw new Error(`Line has zero or negative quantity — aborting post`);

            const unitCost = Number(line.unitPrice);
            const totalValue = qtyToPost * unitCost;

            // WAC upsert
            const balance = await tx.stockBalance.findUnique({
                where: {
                    tenantId_itemId_locationId: {
                        tenantId,
                        itemId: line.internalItemId,
                        locationId: grn.locationId,
                    },
                },
            });

            const prevQty = balance ? Number(balance.qtyOnHand) : 0;
            const prevWac = balance ? Number(balance.wacUnitCost) : 0;
            const newQty = prevQty + qtyToPost;
            const newWac = newQty > 0
                ? ((prevQty * prevWac) + (qtyToPost * unitCost)) / newQty
                : unitCost;

            await tx.stockBalance.upsert({
                where: {
                    tenantId_itemId_locationId: {
                        tenantId,
                        itemId: line.internalItemId,
                        locationId: grn.locationId,
                    },
                },
                create: {
                    tenantId,
                    itemId: line.internalItemId,
                    locationId: grn.locationId,
                    qtyOnHand: newQty,
                    wacUnitCost: newWac,
                },
                update: { qtyOnHand: newQty, wacUnitCost: newWac, lastUpdated: new Date() },
            });

            const prevBalance = balance ? (prevQty * prevWac) : 0;
            const runningBalanceValue = prevBalance + totalValue;

            await tx.inventoryLedger.create({
                data: {
                    tenantId,
                    itemId: line.internalItemId,
                    locationId: grn.locationId,
                    movementType: 'RECEIVE',
                    qtyIn: qtyToPost,
                    qtyOut: 0,
                    unitCost: newWac,
                    totalValue,
                    referenceType: 'GRN',
                    referenceId: grn.id,
                    referenceNo: grn.grnNumber,
                    notes: `GRN: ${grn.grnNumber} | Supplier: ${grn.vendorNameSnapshot}`,
                    createdBy: userId,
                },
            });
        }

        await tx.grnImport.update({
            where: { id: grnId },
            data: { status: 'POSTED', postedAt: new Date(), updatedAt: new Date() },
        });
    });

    return prisma.grnImport.findUnique({
        where: { id: grnId },
        include: {
            lines: true,
            vendor: { select: { name: true } },
            location: { select: { name: true } },
        },
    });
};

// ─── Queries ─────────────────────────────────────────────────────────────────

const listGrns = async (tenantId, { status, page = 1, limit = 20 } = {}) => {
    const where = { tenantId, ...(status ? { status } : {}) };
    const [total, data] = await Promise.all([
        prisma.grnImport.count({ where }),
        prisma.grnImport.findMany({
            where,
            include: {
                vendor: { select: { name: true } },
                location: { select: { name: true } },
                importedByUser: { select: { firstName: true, lastName: true } },
                _count: { select: { lines: true } },
            },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);
    return { total, page, limit, data };
};

const getGrn = async (grnId, tenantId) => {
    const grn = await prisma.grnImport.findFirst({
        where: { id: grnId, tenantId },
        include: {
            vendor: { select: { name: true } },
            location: { select: { name: true } },
            importedByUser: { select: { firstName: true, lastName: true } },
            approvedByUser: { select: { firstName: true, lastName: true } },
            rejectedByUser: { select: { firstName: true, lastName: true } },
            lines: true,
        },
    });
    if (!grn) throw Object.assign(new Error('GRN not found'), { status: 404 });

    // Enrich lines with item and UOM names via separate queries
    if (grn.lines.length > 0) {
        const itemIds = [...new Set(grn.lines.map(l => l.internalItemId).filter(Boolean))];
        const uomIds = [...new Set(grn.lines.map(l => l.internalUomId).filter(Boolean))];
        const [items, units] = await Promise.all([
            itemIds.length ? prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true, barcode: true } }) : [],
            uomIds.length ? prisma.unit.findMany({ where: { id: { in: uomIds } }, select: { id: true, name: true, abbreviation: true } }) : [],
        ]);
        const itemMap = Object.fromEntries(items.map(i => [i.id, i]));
        const uomMap = Object.fromEntries(units.map(u => [u.id, u]));
        grn.lines = grn.lines.map(l => ({
            ...l,
            item: itemMap[l.internalItemId] || null,
            uom: uomMap[l.internalUomId] || null,
        }));
    }

    return grn;
};

// ─── Mutations ────────────────────────────────────────────────────────────────

const updateGrnNotes = async (grnId, tenantId, notes) => {
    const grn = await prisma.grnImport.findFirst({ where: { id: grnId, tenantId } });
    if (!grn) throw Object.assign(new Error('GRN not found'), { status: 404 });

    const IMMUTABLE = ['POSTED', 'REJECTED'];
    if (IMMUTABLE.includes(grn.status))
        throw Object.assign(new Error(`GRN is ${grn.status} and is fully read-only.`), { status: 423 });

    return prisma.grnImport.update({
        where: { id: grnId },
        data: { notes, updatedAt: new Date() },
    });
};

const deleteGrn = async (grnId, tenantId) => {
    const grn = await prisma.grnImport.findFirst({ where: { id: grnId, tenantId } });
    if (!grn) throw Object.assign(new Error('GRN not found'), { status: 404 });

    if (grn.status !== 'DRAFT')
        throw Object.assign(
            new Error(`Only DRAFT GRNs can be deleted. Current status: ${grn.status}`),
            { status: 423 }
        );

    await prisma.grnImport.delete({ where: { id: grnId } });
};

// ─── Excel Template ───────────────────────────────────────────────────────────

/**
 * Generate a GRN Excel template with sample data.
 * Columns: Item Barcode | Item Name (for reference) | Ordered Qty | Received Qty* | Unit Price
 */
const generateGrnTemplate = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('GRN Template');

    ws.columns = [
        { header: 'Item Barcode *', key: 'barcode', width: 22 },
        { header: 'Item Name (ref)', key: 'itemName', width: 30 },
        { header: 'Ordered Qty', key: 'orderedQty', width: 14 },
        { header: 'Received Qty *', key: 'receivedQty', width: 14 },
        { header: 'Unit Price', key: 'unitPrice', width: 14 },
    ];

    // Style header row
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 24;

    // Sample rows
    ws.addRow({ barcode: 'ITEM-001', itemName: 'Example Item 1', orderedQty: 10, receivedQty: 10, unitPrice: 25.00 });
    ws.addRow({ barcode: 'ITEM-002', itemName: 'Example Item 2', orderedQty: 5, receivedQty: 4, unitPrice: 12.50 });

    // Instructions sheet
    const info = wb.addWorksheet('Instructions');
    info.getColumn(1).width = 70;
    info.addRow(['GRN Import Template — Instructions']).font = { bold: true, size: 13 };
    info.addRow(['']);
    info.addRow(['1. Item Barcode is REQUIRED and must match an existing item in the system.']);
    info.addRow(['2. Received Qty is REQUIRED and must be greater than 0.']);
    info.addRow(['3. Item Name column is for your reference — it is NOT used during import.']);
    info.addRow(['4. Leave Ordered Qty / Unit Price empty if not applicable.']);
    info.addRow(['5. Do NOT change column headers or add/remove columns.']);
    info.addRow(['6. After upload, any rows with invalid barcodes will be shown as errors and skipped.']);

    return wb;
};

// ─── Excel Preview ────────────────────────────────────────────────────────────

/**
 * Parse uploaded GRN Excel, validate each row against Item Master.
 */
const previewGrnExcel = async (filePath, tenantId) => {
    const wb = new ExcelJS.Workbook();
    try {
        await wb.xlsx.readFile(filePath);
    } catch {
        throw Object.assign(new Error('Failed to read Excel file. Make sure it is a valid .xlsx or .xls file.'), { status: 400 });
    }

    const ws = wb.worksheets[0];
    if (!ws) throw Object.assign(new Error('Excel file is empty.'), { status: 400 });

    // Read header row to find columns
    const headerRow = ws.getRow(1);
    const colMap = {};
    headerRow.eachCell((cell, colNum) => {
        const h = (cell.value || '').toString().toLowerCase().trim();
        if (h.includes('barcode')) colMap.barcode = colNum;
        if (h.includes('name') || h.includes('item name')) colMap.itemName = colNum;
        if (h.includes('ordered')) colMap.orderedQty = colNum;
        if (h.includes('received')) colMap.receivedQty = colNum;
        if (h.includes('price')) colMap.unitPrice = colNum;
    });

    if (!colMap.barcode && !colMap.itemName) throw Object.assign(new Error('"Item Barcode" or "Item Name" column not found. Use the provided template.'), { status: 400 });
    if (!colMap.receivedQty) throw Object.assign(new Error('"Received Qty" column not found. Use the provided template.'), { status: 400 });

    // Collect rows — accept rows with barcode OR item name
    const rawRows = [];
    ws.eachRow((row, rowNum) => {
        if (rowNum === 1) return; // skip header
        const barcode = colMap.barcode ? (row.getCell(colMap.barcode).value || '').toString().trim() : '';
        const nameVal = colMap.itemName ? (row.getCell(colMap.itemName).value || '').toString().trim() : '';
        // Skip rows that have neither barcode nor name
        if (!barcode && !nameVal) return;
        const rcvCell = row.getCell(colMap.receivedQty);
        if (!rcvCell.value && rcvCell.value !== 0) return; // skip fully empty rows
        rawRows.push({
            rowNum,
            barcode: barcode || null,
            itemName: nameVal || null,
            orderedQty: Number(colMap.orderedQty ? row.getCell(colMap.orderedQty).value : 0) || 0,
            receivedQty: rcvCell.value,
            unitPrice: Number(colMap.unitPrice ? row.getCell(colMap.unitPrice).value : 0) || 0,
        });
    });

    if (rawRows.length === 0) throw Object.assign(new Error('No data rows found in the file. Make sure the rows have Item Barcode or Item Name filled in.'), { status: 400 });
    if (rawRows.length > 500) throw Object.assign(new Error('Too many rows. Maximum 500 rows per import.'), { status: 400 });

    // Resolve barcodes → items (primary), then fallback to name (case-insensitive)
    const barcodes = [...new Set(rawRows.map(r => r.barcode).filter(Boolean))];
    const names = [...new Set(rawRows.map(r => r.itemName).filter(Boolean))];
    const items = await prisma.item.findMany({
        where: {
            tenantId,
            OR: [
                ...(barcodes.length ? [{ barcode: { in: barcodes } }] : []),
                ...(names.length ? [{ name: { in: names, mode: 'insensitive' } }] : []),
            ]
        },
        include: { itemUnits: { where: { unitType: 'BASE' }, include: { unit: true } } },
    });
    const itemByBarcode = Object.fromEntries(items.filter(i => i.barcode).map(i => [i.barcode.toLowerCase(), i]));
    const itemByName = Object.fromEntries(items.map(i => [i.name.toLowerCase(), i]));

    const rows = [];
    let valid = 0;
    let invalid = 0;

    for (const raw of rawRows) {
        const errors = [];
        // lookup by barcode first, then name
        const item = (raw.barcode ? itemByBarcode[raw.barcode.toLowerCase()] : null)
            || (raw.itemName ? itemByName[raw.itemName.toLowerCase()] : null);
        const rcvQty = Number(raw.receivedQty);

        if (!item) errors.push(`Item "${raw.barcode || raw.itemName}" not found in Item Master.`);
        if (!rcvQty || rcvQty <= 0) errors.push('Received Qty must be greater than 0.');

        const baseUnit = item?.itemUnits?.[0];
        const ok = errors.length === 0;
        if (ok) valid++; else invalid++;

        rows.push({
            rowNum: raw.rowNum,
            barcode: raw.barcode || item?.barcode || '—',
            itemName: item?.name || raw.itemName || '—',
            itemId: item?.id || null,
            uomId: baseUnit?.unitId || null,
            orderedQty: raw.orderedQty,
            receivedQty: rcvQty,
            unitPrice: raw.unitPrice,
            status: ok ? 'VALID' : 'ERROR',
            errors,
        });
    }

    return { total: rawRows.length, valid, invalid, rows };
};

// ─── PDF Smart Extraction Helpers ──────────────────────────────────────────

// Lines that are definitely NOT item lines
const PDF_SKIP_RE = /^\s*(total|sub.?total|vat|tax|discount|invoice|date|due|payment|page|po|attention|bill to|ship to|from|to|dear|ref|item|qty|quantity|unit|price|amount|gross|net|balance|terms|thank|regards|generated|prepared|authorized)\b/i;

const NOISE_WORDS = new Set(['the', 'and', 'for', 'pcs', 'box', 'ctn', 'doz', 'each', 'ea', 'pc', 'set', 'roll', 'bag', 'btl', 'bottle', 'pack', 'case', 'nos', 'no', 'piece', 'pieces']);

// Normalize text for fuzzy comparison
const normPdf = (str) => (str || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// % of pattern words found in text
const fuzzyPdfScore = (text, pattern) => {
    const tWords = new Set(normPdf(text).split(' ').filter(w => w.length > 2 && !NOISE_WORDS.has(w)));
    const pWords = normPdf(pattern).split(' ').filter(w => w.length > 2 && !NOISE_WORDS.has(w));
    if (!pWords.length || !tWords.size) return 0;
    const matched = pWords.filter(w => [...tWords].some(t => t === w || t.includes(w) || w.includes(t)));
    return Math.round((matched.length / pWords.length) * 100);
};

// ─── PDF Preview (Smart Multi-Strategy) ─────────────────────────────────────

/**
 * Smart PDF invoice parser.
 * Extracts item-like lines (description + qty) and matches them to Item Master
 * using: exact barcode → fuzzy name (>=60%) → UNMAPPED (needs manual mapping).
 */
const previewGrnPdf = async (filePath, tenantId) => {
    // ── Step 1: Extract raw text ─────────────────────────────────────────────
    let pdfText = '';
    try {
        const buffer = fs.readFileSync(filePath);
        const data = await pdfParse(buffer, { max: 0 });
        pdfText = data.text || '';
    } catch (err) {
        console.warn('[GRN PDF] pdf-parse failed:', err.message);
        return {
            total: 0, valid: 0, suggested: 0, unmapped: 0, invalid: 0, rows: [],
            warning: 'Could not extract text from this PDF. It may be a scanned image or encrypted. Use Import Excel instead.',
        };
    }

    if (!pdfText.trim()) {
        return {
            total: 0, valid: 0, suggested: 0, unmapped: 0, invalid: 0, rows: [],
            warning: 'No readable text found in this PDF. It may be a scanned/image PDF. Use Import Excel instead.',
        };
    }

    // ── Step 2: Detect candidate item lines ──────────────────────────────────
    const textLines = pdfText.split(/\n/);
    const candidates = [];

    textLines.forEach((rawLine, idx) => {
        const line = rawLine.trim();
        if (!line || line.length < 5) return;
        if (PDF_SKIP_RE.test(line)) return;
        if (!/\d/.test(line)) return; // must contain a number

        // Pattern: [description text] [number=qty] [optional unit text] [optional number=price]
        const m = /^(.{3,80?})\s+(\d[\d,]*(?:\.\d+)?)\s*([A-Za-z]{2,5})?\s*([\d,]+(?:\.\d+)?)?\s*([\d,]+(?:\.\d+)?)?$/.exec(line);
        if (!m) {
            // Fallback: text before first standalone number block
            const fb = /^([A-Za-z][^\d]{2,60})\s+(\d[\d,.]+)(?:\s+([\d,.]+))?/.exec(line);
            if (!fb) return;
            const qty = parseFloat(fb[2].replace(',', '.'));
            if (!qty || qty <= 0 || qty > 99999) return;
            candidates.push({ rowNum: idx + 1, rawLine: line, description: fb[1].trim(), qty, unit: null, unitPrice: fb[3] ? parseFloat(fb[3].replace(',', '.')) : 0 });
            return;
        }

        const desc = m[1].trim();
        const qty = parseFloat(m[2].replace(',', '.'));
        if (!qty || qty <= 0 || qty > 99999) return;
        if (desc.length < 3) return;

        let unit = null;
        let price = 0;
        if (m[3] && isNaN(Number(m[3]))) {
            unit = m[3];
            price = m[4] ? parseFloat(m[4].replace(',', '.')) : 0;
        } else {
            price = m[3] ? parseFloat(m[3].replace(',', '.')) : 0;
        }

        candidates.push({ rowNum: idx + 1, rawLine: line, description: desc, qty, unit, unitPrice: price || 0 });
    });

    if (candidates.length === 0) {
        return {
            total: 0, valid: 0, suggested: 0, unmapped: 0, invalid: 0, rows: [],
            warning: 'Could not detect any item lines in this PDF. Make sure it contains a structured item list with quantities.',
        };
    }

    // ── Step 3: Load all tenant items for matching ───────────────────────────
    const allItems = await prisma.item.findMany({
        where: { tenantId, isActive: true },
        include: { itemUnits: { where: { unitType: 'BASE' }, include: { unit: true } } },
        take: 3000,
    });
    const itemByBarcode = {};
    allItems.forEach(i => { if (i.barcode) itemByBarcode[i.barcode.toLowerCase()] = i; });

    // ── Step 4: Match each candidate ─────────────────────────────────────────
    const usedItemIds = new Set();
    const rows = [];
    let valid = 0, suggested = 0, unmapped = 0;

    for (const cand of candidates) {
        const descLower = cand.description.toLowerCase();

        // Strategy A: Exact barcode match (whole description or first token)
        let matchedItem = itemByBarcode[descLower];
        if (!matchedItem) {
            const firstToken = cand.description.split(/\s+/)[0].toLowerCase();
            matchedItem = itemByBarcode[firstToken];
        }

        let confidence = matchedItem ? 100 : 0;
        let status = 'UNMAPPED';

        // Strategy B: Fuzzy name match
        if (!matchedItem) {
            let bestScore = 0;
            let bestItem = null;
            for (const item of allItems) {
                const score = fuzzyPdfScore(cand.description, item.name);
                if (score > bestScore) { bestScore = score; bestItem = item; }
            }
            if (bestScore >= 60) {
                matchedItem = bestItem;
                confidence = bestScore;
                status = 'SUGGESTED';
            }
        } else {
            status = 'VALID';
        }

        // Merge duplicates (same item mapped from different PDF lines → sum qty)
        if (matchedItem && usedItemIds.has(matchedItem.id)) {
            const existingRow = rows.find(r => r.itemId === matchedItem.id);
            if (existingRow) { existingRow.receivedQty += cand.qty; continue; }
        }
        if (matchedItem) usedItemIds.add(matchedItem.id);

        const baseUnit = matchedItem?.itemUnits?.[0];
        const errors = [];

        if (!matchedItem) {
            status = 'UNMAPPED';
            errors.push('No matching item found in Item Master — please map manually.');
            unmapped++;
        } else if (status === 'SUGGESTED') {
            errors.push(`Auto-matched with ${confidence}% confidence — please verify.`);
            suggested++;
        } else {
            valid++;
        }

        rows.push({
            rowNum: cand.rowNum,
            extractedText: cand.description,
            extractedQty: cand.qty,
            extractedUnit: cand.unit,
            extractedPrice: cand.unitPrice,
            barcode: matchedItem?.barcode || null,
            itemName: matchedItem?.name || null,
            itemId: matchedItem?.id || null,
            uomId: baseUnit?.unitId || null,
            uomName: baseUnit?.unit?.abbreviation || null,
            orderedQty: 0,
            receivedQty: cand.qty,
            unitPrice: cand.unitPrice,
            status,
            confidence,
            errors,
        });
    }

    return { total: rows.length, valid, suggested, unmapped, invalid: 0, rows };
};

module.exports = {
    createGrn,
    validateGrn,
    submitForApproval,
    approveGrn,
    rejectGrn,
    postGrn,
    listGrns,
    getGrn,
    updateGrnNotes,
    deleteGrn,
    generateGrnTemplate,
    previewGrnExcel,
    previewGrnPdf,
};
