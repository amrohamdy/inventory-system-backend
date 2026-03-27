'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const normalizeVendorName = (name = '') => name.trim().toLowerCase().replace(/\s+/g, ' ');

// ─── Item Mapping ─────────────────────────────────────────────────────────────

const upsertItemMapping = async ({ tenantId, futurelogItemCode, futurelogItemName, internalItemId, userId }) => {
    // Verify the internal item exists
    const item = await prisma.item.findFirst({ where: { id: internalItemId, tenantId } });
    if (!item) throw Object.assign(new Error('Internal item not found'), { status: 404 });

    const existing = await prisma.itemMapping.findUnique({
        where: { tenantId_futurelogItemCode: { tenantId, futurelogItemCode } },
    });

    const result = await prisma.itemMapping.upsert({
        where: { tenantId_futurelogItemCode: { tenantId, futurelogItemCode } },
        create: { tenantId, futurelogItemCode, futurelogItemName, internalItemId, createdBy: userId, updatedBy: userId },
        update: { futurelogItemName, internalItemId, updatedBy: userId, updatedAt: new Date() },
    });

    // Audit log
    await prisma.auditLog.create({
        data: {
            tenantId,
            entityType: 'ItemMapping',
            entityId: result.id,
            action: existing ? 'UPDATE' : 'CREATE',
            changedBy: userId,
            beforeValue: existing ? { internalItemId: existing.internalItemId } : null,
            afterValue: { internalItemId },
        },
    });

    // Re-apply to any DRAFT GRN lines that reference this FutureLog item code
    await reapplyItemMappingToLines(tenantId, futurelogItemCode, internalItemId);

    return result;
};

const listItemMappings = async (tenantId) => {
    return prisma.itemMapping.findMany({
        where: { tenantId },
        include: { tenant: false },
        orderBy: { futurelogItemCode: 'asc' },
    });
};

/** After saving an item mapping, update any unresolved GRN lines automatically */
const reapplyItemMappingToLines = async (tenantId, futurelogItemCode, internalItemId) => {
    // Find unmapped lines in non-posted GRNs belonging to this tenant
    const lines = await prisma.grnLine.findMany({
        where: {
            futurelogItemCode,
            internalItemId: null,
            grnImport: { tenantId, status: { notIn: ['POSTED', 'REJECTED'] } },
        },
    });
    for (const line of lines) {
        const uomMap = await prisma.uomMapping.findUnique({
            where: { tenantId_futurelogUom: { tenantId, futurelogUom: line.futurelogUom } },
        });
        const internalUomId = uomMap?.internalUomId ?? line.internalUomId;
        const conversionFactor = uomMap ? Number(uomMap.conversionFactor) : Number(line.conversionFactor);
        const isMapped = !!(internalItemId && internalUomId);
        const qtyInBaseUnit = isMapped ? Number(line.receivedQty) * conversionFactor : 0;
        await prisma.grnLine.update({
            where: { id: line.id },
            data: { internalItemId, internalUomId, conversionFactor, isMapped, qtyInBaseUnit },
        });
    }
};

// ─── UOM Mapping ──────────────────────────────────────────────────────────────

const upsertUomMapping = async ({ tenantId, futurelogUom, internalUomId, conversionFactor, userId }) => {
    if (!conversionFactor || Number(conversionFactor) <= 0)
        throw Object.assign(new Error('conversionFactor must be greater than 0'), { status: 400 });

    const unit = await prisma.unit.findFirst({ where: { id: internalUomId, tenantId } });
    if (!unit) throw Object.assign(new Error('Internal UOM not found'), { status: 404 });

    const existing = await prisma.uomMapping.findUnique({
        where: { tenantId_futurelogUom: { tenantId, futurelogUom } },
    });

    const result = await prisma.uomMapping.upsert({
        where: { tenantId_futurelogUom: { tenantId, futurelogUom } },
        create: { tenantId, futurelogUom, internalUomId, conversionFactor, createdBy: userId, updatedBy: userId },
        update: { internalUomId, conversionFactor, updatedBy: userId, updatedAt: new Date() },
    });

    await prisma.auditLog.create({
        data: {
            tenantId,
            entityType: 'UomMapping',
            entityId: result.id,
            action: existing ? 'UPDATE' : 'CREATE',
            changedBy: userId,
            beforeValue: existing ? { internalUomId: existing.internalUomId, conversionFactor: existing.conversionFactor } : null,
            afterValue: { internalUomId, conversionFactor },
        },
    });

    return result;
};

const listUomMappings = async (tenantId) => {
    return prisma.uomMapping.findMany({
        where: { tenantId },
        orderBy: { futurelogUom: 'asc' },
    });
};

// ─── Vendor Mapping ───────────────────────────────────────────────────────────

const upsertVendorMapping = async ({ tenantId, futurelogVendorName, internalSupplierId, userId }) => {
    const normalized = normalizeVendorName(futurelogVendorName);

    const supplier = await prisma.supplier.findFirst({ where: { id: internalSupplierId, tenantId } });
    if (!supplier) throw Object.assign(new Error('Internal supplier not found'), { status: 404 });

    const existing = await prisma.vendorMapping.findUnique({
        where: { tenantId_futurelogVendorName: { tenantId, futurelogVendorName: normalized } },
    });

    const result = await prisma.vendorMapping.upsert({
        where: { tenantId_futurelogVendorName: { tenantId, futurelogVendorName: normalized } },
        create: { tenantId, futurelogVendorName: normalized, internalSupplierId, createdBy: userId, updatedBy: userId },
        update: { internalSupplierId, updatedBy: userId, updatedAt: new Date() },
    });

    await prisma.auditLog.create({
        data: {
            tenantId,
            entityType: 'VendorMapping',
            entityId: result.id,
            action: existing ? 'UPDATE' : 'CREATE',
            changedBy: userId,
            beforeValue: existing ? { internalSupplierId: existing.internalSupplierId } : null,
            afterValue: { internalSupplierId },
        },
    });

    // Re-apply vendor match to any DRAFT GRNs with this unmatched vendor name
    await prisma.grnImport.updateMany({
        where: {
            tenantId,
            vendorId: null,
            vendorNameSnapshot: { equals: futurelogVendorName.trim(), mode: 'insensitive' },
            status: { notIn: ['POSTED', 'REJECTED'] },
        },
        data: { vendorId: internalSupplierId, updatedAt: new Date() },
    });

    return result;
};

const listVendorMappings = async (tenantId) => {
    return prisma.vendorMapping.findMany({
        where: { tenantId },
        orderBy: { futurelogVendorName: 'asc' },
    });
};

/** Returns a list of unique unmatched vendor names from DRAFT GRNs for this tenant */
const getUnmatchedVendors = async (tenantId) => {
    return prisma.grnImport.findMany({
        where: { tenantId, vendorId: null, status: { notIn: ['POSTED', 'REJECTED'] } },
        select: { id: true, grnNumber: true, vendorNameSnapshot: true, status: true },
        distinct: ['vendorNameSnapshot'],
        orderBy: { createdAt: 'desc' },
    });
};

/**
 * Re-apply all existing mappings (item, UOM, vendor) to a specific GRN.
 * Useful after saving new mappings to update the GRN's line statuses.
 */
const applyMappingsToGrn = async (grnId, tenantId) => {
    const grn = await prisma.grnImport.findFirst({
        where: { id: grnId, tenantId },
        include: { lines: true },
    });
    if (!grn) throw Object.assign(new Error('GRN not found'), { status: 404 });

    // Re-resolve vendor
    const vendorMap = await prisma.vendorMapping.findFirst({
        where: {
            tenantId,
            futurelogVendorName: normalizeVendorName(grn.vendorNameSnapshot),
        },
    });
    if (vendorMap && !grn.vendorId) {
        await prisma.grnImport.update({
            where: { id: grnId },
            data: { vendorId: vendorMap.internalSupplierId, updatedAt: new Date() },
        });
    }

    // Re-resolve lines
    for (const line of grn.lines) {
        const itemMap = await prisma.itemMapping.findUnique({
            where: { tenantId_futurelogItemCode: { tenantId, futurelogItemCode: line.futurelogItemCode } },
        });
        const uomMap = await prisma.uomMapping.findUnique({
            where: { tenantId_futurelogUom: { tenantId, futurelogUom: line.futurelogUom } },
        });

        const internalItemId = itemMap?.internalItemId ?? line.internalItemId;
        const internalUomId = uomMap?.internalUomId ?? line.internalUomId;
        const conversionFactor = uomMap ? Number(uomMap.conversionFactor) : Number(line.conversionFactor);
        const isMapped = !!(internalItemId && internalUomId);
        const qtyInBaseUnit = isMapped ? Number(line.receivedQty) * conversionFactor : 0;

        await prisma.grnLine.update({
            where: { id: line.id },
            data: { internalItemId, internalUomId, conversionFactor, isMapped, qtyInBaseUnit },
        });
    }

    return prisma.grnImport.findFirst({ where: { id: grnId, tenantId }, include: { lines: true } });
};

module.exports = {
    upsertItemMapping,
    listItemMappings,
    upsertUomMapping,
    listUomMappings,
    upsertVendorMapping,
    listVendorMappings,
    getUnmatchedVendors,
    applyMappingsToGrn,
};
