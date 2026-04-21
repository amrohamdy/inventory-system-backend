const { PrismaClient } = require('@prisma/client');
const { validate: uuidValidate } = require('uuid');
const prisma = new PrismaClient();

const MAX_ITEM_PAGE = 1000;
const MAX_ITEM_SLIM = 5000;

const isSlimQuery = (value) => value === 'true' || value === true;

const parseItemPagination = (querySkip, queryTake, defaultTake = 20) => {
    let skip = parseInt(querySkip, 10);
    if (!Number.isFinite(skip) || skip < 0) skip = 0;
    let take = parseInt(queryTake, 10);
    if (!Number.isFinite(take) || take < 1) take = defaultTake;
    take = Math.min(take, MAX_ITEM_PAGE);
    return { skip, take };
};

const XLSX = require('xlsx');
const path = require('path');
const auditService = require('./audit.service');
const settingService = require('./setting.service');
const { checkOpeningBalanceAllowed } = require('./periodGuard.service');
const { getStorage } = require('../config/storage');

/**
 * Per-item opening qty from live data: sum of `qtyInBaseUnit` on all MovementLine rows whose
 * parent MovementDocument is OPENING_BALANCE + DRAFT for this tenant (not a column on Item).
 * Used for GET /items and GET /items/:id when the tenant is in the OB OPEN phase.
 */
const loadOpeningBalanceDraftAgg = async (tenantId, itemIds) => {
    const ids = [...new Set((itemIds || []).filter(Boolean))];
    const map = new Map();
    if (ids.length === 0) return map;

    const grouped = await prisma.movementLine.groupBy({
        by: ['itemId'],
        where: {
            itemId: { in: ids },
            document: {
                tenantId,
                movementType: 'OPENING_BALANCE',
                status: 'DRAFT',
            },
        },
        _sum: {
            qtyInBaseUnit: true,
        },
    });

    for (const row of grouped) {
        const q = Number(row._sum.qtyInBaseUnit ?? 0);
        if (!Number.isFinite(q)) continue;
        map.set(row.itemId, { qtySum: q });
    }

    return map;
};

const buildItemEnrichmentCtx = async (tenantId, itemIds) => {
    const obStatus = await settingService.getObStatus(tenantId);
    const ids = [...new Set(([]).concat(itemIds || []).filter(Boolean))];
    const draftAgg =
        obStatus === 'OPEN' && ids.length > 0 ? await loadOpeningBalanceDraftAgg(tenantId, ids) : new Map();
    return { obStatus, draftAgg };
};

const sumStockBalances = (item) => {
    const balances = item?.stockBalances;
    let qty = 0;
    let valueSum = 0;
    if (Array.isArray(balances)) {
        for (const b of balances) {
            const q = Number(b.qtyOnHand ?? 0);
            const wac = Number(b.wacUnitCost ?? 0);
            if (Number.isFinite(q)) qty += q;
            if (Number.isFinite(q) && Number.isFinite(wac)) valueSum += q * wac;
        }
    }
    const unitCost = qty > 0 ? valueSum / qty : 0;
    return { qty, valueSum, unitCost };
};

const enrichSingleItemForResponse = async (item, tenantId) => {
    if (!item || typeof item !== 'object') return item;
    const ctx = await buildItemEnrichmentCtx(tenantId, [item.id]);
    const enriched = enrichItemWithOpeningFields(item, ctx);
    return attachDisplayImageUrl(enriched);
};

const toStorageKeyFromUrlPath = (pathname) => {
    if (typeof pathname !== 'string' || !pathname) return null;
    if (pathname.startsWith('/uploads/')) return pathname;

    const marker = '/tenants/';
    const idx = pathname.indexOf(marker);
    if (idx >= 0) {
        return pathname.slice(idx + 1);
    }

    if (pathname.startsWith('/tenants/')) {
        return pathname.slice(1);
    }

    return null;
};

const normalizeIncomingImageUrl = (value) => {
    if (value == null) return value;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('/uploads/') || trimmed.startsWith('tenants/')) {
        return trimmed;
    }
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        try {
            const parsed = new URL(trimmed);
            const key = toStorageKeyFromUrlPath(parsed.pathname);
            return key || trimmed;
        } catch {
            return trimmed;
        }
    }
    return trimmed;
};

const attachDisplayImageUrl = async (item) => {
    if (!item || typeof item !== 'object') return item;
    if (!item.imageUrl) return { ...item, imageDisplayUrl: null };
    try {
        const storage = getStorage();
        const imageDisplayUrl = await storage.getSignedUrl(item.imageUrl);
        return { ...item, imageDisplayUrl };
    } catch {
        return { ...item, imageDisplayUrl: null };
    }
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const ITEM_INCLUDE = {
    department: { select: { id: true, name: true, code: true } },
    category: { select: { id: true, name: true } },
    subcategory: { select: { id: true, name: true } },
    supplier: { select: { id: true, name: true } },
    defaultStore: { select: { id: true, name: true, departmentId: true } },
    itemUnits: { include: { unit: { select: { id: true, name: true, abbreviation: true } } } },
    stockBalances: {
        select: {
            qtyOnHand: true,
            wacUnitCost: true,
            location: { select: { id: true, name: true } },
        },
    },
};

const roundQtyDisplay = (n) => Math.round(n * 10000) / 10000;

/** Virtual opening qty: sum of DRAFT OPENING_BALANCE movement lines (see `loadOpeningBalanceDraftAgg`). */
const openingQuantityFromDraftAgg = (draftAgg, itemId) => {
    const entry = draftAgg?.get(itemId);
    if (!entry) return 0;
    const q = Number(entry.qtySum);
    return Number.isFinite(q) ? q : 0;
};

/**
 * List/detail enrichment: opening qty plus displayTotalQty (same value in OPEN phase).
 * - OPEN: both fields = sum of all related MovementLine rows on DRAFT OPENING_BALANCE documents
 *   (`qtyInBaseUnit`), across locations — aligns with Excel `openingQuantityTotal`.
 * - Otherwise: both = on-hand qty from posted stock_balances (OB finalized / locked).
 */
const enrichItemWithOpeningFields = (item, ctx = null) => {
    if (!item || typeof item !== 'object') return item;
    const obStatus = ctx?.obStatus ?? null;
    const draftOpeningQty = openingQuantityFromDraftAgg(ctx?.draftAgg, item.id);

    if (obStatus === 'OPEN') {
        return {
            ...item,
            openingQuantity: roundQtyDisplay(draftOpeningQty),
            displayTotalQty: roundQtyDisplay(draftOpeningQty),
        };
    }

    const { qty } = sumStockBalances(item);
    return {
        ...item,
        openingQuantity: roundQtyDisplay(qty),
        displayTotalQty: roundQtyDisplay(qty),
    };
};

/** Master catalog / Get Pass — no stock rows, smaller payload for large take */
const ITEM_CATALOG_INCLUDE = {
    department: { select: { id: true, name: true, code: true } },
    category: { select: { id: true, name: true } },
    subcategory: { select: { id: true, name: true } },
    supplier: { select: { id: true, name: true } },
    defaultStore: { select: { id: true, name: true, departmentId: true } },
    itemUnits: { include: { unit: { select: { id: true, name: true, abbreviation: true } } } },
};

const notFound = (msg = 'Item not found') => {
    const e = new Error(msg);
    e.statusCode = 404;
    return e;
};

const badRequest = (msg) => {
    const e = new Error(msg);
    e.statusCode = 400;
    return e;
};

const forbidden = (msg) => {
    const e = new Error(msg);
    e.statusCode = 403;
    return e;
};

const assertDepartmentInTenant = async (departmentId, tenantId) => {
    const dept = await prisma.department.findFirst({
        where: { id: departmentId, tenantId },
        select: { id: true },
    });
    if (!dept) throw notFound('Department not found');
};

const parseExcelNumber = (val) => {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return val;
    const normalized = String(val).replace(/,/g, '').trim();
    const parsed = parseFloat(normalized);
    return Number.isNaN(parsed) ? NaN : parsed;
};

/**
 * Prerequisite counts for Item Master (tenant-scoped).
 * canCreateItem is true when departments, units, categories, suppliers (vendors), and locations all exist (independent of OB phase).
 * isOpeningBalanceAllowed mirrors `settingService.isOpeningBalanceAllowed` (OPEN phase vs finalized/locked).
 * Used for UI banners / period guards; item create/import are not blocked when this is false.
 */
const checkItemCreationRequirements = async (tenantId) => {
    const [departments, units, categories, vendors, locations] = await Promise.all([
        prisma.department.count({ where: { tenantId } }),
        prisma.unit.count({ where: { tenantId } }),
        prisma.category.count({ where: { tenantId } }),
        prisma.supplier.count({ where: { tenantId } }),
        prisma.location.count({ where: { tenantId } }),
    ]);

    const requirements = {
        departments: { count: departments },
        units: { count: units },
        categories: { count: categories },
        vendors: { count: vendors },
        locations: { count: locations },
    };

    const obCheck = await settingService.isOpeningBalanceAllowed(tenantId);
    const isOpeningBalanceAllowed = obCheck.allowed === true;
    const obStatus = await settingService.getObStatus(tenantId);

    const hasPrerequisites =
        departments > 0 &&
        units > 0 &&
        categories > 0 &&
        vendors > 0 &&
        locations > 0;
    const isItemCreationPhaseAllowed = obStatus === 'OPEN' || obStatus === 'FINALIZED';
    const canCreateItem = hasPrerequisites && isItemCreationPhaseAllowed;

    if (!canCreateItem) {
        const blockReason = !hasPrerequisites ? 'MISSING_PREREQUISITES' : 'INITIAL_LOCK';
        return {
            canCreateItem: false,
            requirements,
            blockReason,
            isOpeningBalanceAllowed,
            obStatus,
        };
    }

    return { canCreateItem: true, requirements, isOpeningBalanceAllowed, obStatus };
};

// ── Validate itemUnits array ───────────────────────────────────────────────────
// Each entry: { unitId, unitType: 'BASE'|'PURCHASE'|'ISSUE', conversionRate }
const validateItemUnits = (itemUnits) => {
    if (!itemUnits || itemUnits.length === 0) return;

    const types = itemUnits.map(u => u.unitType);

    // Only one BASE unit allowed
    const baseCount = types.filter(t => t === 'BASE').length;
    if (baseCount > 1) throw badRequest('Only one BASE unit is allowed per item.');

    // Validate conversion rates
    for (const u of itemUnits) {
        const rate = parseFloat(u.conversionRate);
        if (isNaN(rate) || rate <= 0) {
            throw badRequest(`Conversion rate must be a positive number. Got: ${u.conversionRate}`);
        }
        if (!['BASE', 'PURCHASE', 'ISSUE'].includes(u.unitType)) {
            throw badRequest(`Invalid unitType "${u.unitType}". Must be BASE, PURCHASE, or ISSUE.`);
        }
    }
};

/** Allowed Item scalar fields from API create/update (excludes id, tenantId, timestamps, relations, virtuals). */
const ITEM_INPUT_WHITELIST = new Set([
    'name', 'description', 'unitPrice', 'barcode', 'categoryId', 'subcategoryId',
    'departmentId', 'supplierId', 'defaultStoreId', 'reorderPoint', 'reorderQty',
    'isActive', 'code', 'imageUrl',
]);

const pickWhitelistedItemPayload = (source) => {
    const out = {};
    if (!source || typeof source !== 'object') return out;
    for (const key of Object.keys(source)) {
        if (ITEM_INPUT_WHITELIST.has(key)) {
            if (key === 'imageUrl') {
                out[key] = normalizeIncomingImageUrl(source[key]);
            } else {
                out[key] = source[key];
            }
        }
    }
    return out;
};

// ── CREATE ─────────────────────────────────────────────────────────────────────
const createItem = async (data, tenantId, userId = null) => {
    const {
        itemUnits,
        openingQuantity,
        displayTotalQty: _displayTotalQty,
        ...bodyRest
    } = data;

    const mainData = pickWhitelistedItemPayload(bodyRest);
    const defaultStoreId = mainData.defaultStoreId;

    validateItemUnits(itemUnits);

    // Department validation (required)
    if (mainData.departmentId) {
        const dept = await prisma.department.findFirst({ where: { id: mainData.departmentId, tenantId } });
        if (!dept) throw badRequest('Department not found in this tenant.');
    }

    // Category existence check (required)
    if (mainData.categoryId) {
        const cat = await prisma.category.findFirst({ where: { id: mainData.categoryId, tenantId } });
        if (!cat) throw badRequest('Category not found in this tenant.');
    }

    // Default Store validation — must belong to selected department
    if (mainData.defaultStoreId) {
        const store = await prisma.location.findFirst({ where: { id: mainData.defaultStoreId, tenantId } });
        if (!store) throw badRequest('Default store not found.');
        if (mainData.departmentId && store.departmentId && store.departmentId !== mainData.departmentId) {
            throw badRequest('Default store does not belong to the selected department.');
        }
    }

    // Auto-generate barcode
    const finalBarcode = mainData.barcode || Math.floor(100000000000 + Math.random() * 900000000000).toString();

    // Uniqueness checks
    const [dupBarcode, dupName] = await Promise.all([
        prisma.item.findFirst({ where: { barcode: finalBarcode, tenantId } }),
        prisma.item.findFirst({ where: { name: mainData.name, tenantId } }),
    ]);

    if (dupBarcode) throw badRequest(`Barcode '${finalBarcode}' already exists in this tenant.`);
    if (dupName) throw badRequest(`Item name '${mainData.name}' already exists.`);

    const obQty = parseFloat(openingQuantity);
    const wantsOpeningLine = Number.isFinite(obQty) && obQty > 0;
    if (wantsOpeningLine && !userId) {
        throw badRequest('User context is required to record opening balance quantity.');
    }

    const obStatus = await settingService.getObStatus(tenantId);
    if (wantsOpeningLine && obStatus !== 'OPEN') {
        throw badRequest('Opening quantity can only be set while Opening Balance is in OPEN status.');
    }

    const movementService = require('./movement.service');

    const createdId = await prisma.$transaction(async (tx) => {
        const created = await tx.item.create({
            data: {
                ...mainData,
                barcode: finalBarcode,
                tenantId,
                ...(itemUnits?.length > 0 && {
                    itemUnits: {
                        create: itemUnits.map(u => ({
                            unitId: u.unitId,
                            unitType: u.unitType,
                            conversionRate: u.conversionRate,
                            isDefault: u.unitType === 'BASE',
                            tenantId,
                        })),
                    },
                }),
            },
            select: { id: true, name: true, unitPrice: true, defaultStoreId: true },
        });

        if (wantsOpeningLine) {
            const locationId = defaultStoreId ?? created.defaultStoreId;
            if (!locationId) {
                throw badRequest('A default store (location) is required when providing opening quantity.');
            }
            const unitCost = Number(created.unitPrice ?? 0);
            if (!(unitCost > 0)) {
                throw badRequest('Unit price is required when providing opening quantity.');
            }
            await upsertOpeningBalanceForItemLocation(
                tx,
                {
                    tenantId,
                    itemId: created.id,
                    locationId,
                    targetQty: obQty,
                    unitCost,
                    userId,
                    itemName: created.name,
                },
                movementService
            );
        }

        return created.id;
    });

    const created = await prisma.item.findFirst({
        where: { id: createdId, tenantId },
        include: ITEM_INCLUDE,
    });
    return enrichSingleItemForResponse(created, tenantId);
};

// ── LIST ───────────────────────────────────────────────────────────────────────
const getItems = async (tenantId, query = {}) => {
    const { search, categoryId, subcategoryId, departmentId, locationId, isActive, catalog, forGetPass, slim } = query;
    const slimMode = isSlimQuery(slim);
    const catalogMode =
        !slimMode &&
        (catalog === 'true' || catalog === true || forGetPass === 'true' || forGetPass === true);

    if (departmentId) {
        if (!uuidValidate(departmentId)) throw badRequest('Invalid departmentId');
        await assertDepartmentInTenant(departmentId, tenantId);
    }

    const hasExplicitIsActive = Object.prototype.hasOwnProperty.call(query, 'isActive');

    const where = {
        tenantId,
        ...(categoryId && { categoryId }),
        ...(subcategoryId && { subcategoryId }),
        ...(departmentId && { departmentId }),
        ...(locationId && { stockBalances: { some: { locationId } } }),
        ...(catalogMode && !hasExplicitIsActive ? { isActive: true } : {}),
        ...(hasExplicitIsActive ? { isActive: isActive === 'true' } : {}),
        ...(search && {
            OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { barcode: { contains: search, mode: 'insensitive' } },
                { department: { name: { contains: search, mode: 'insensitive' } } },
            ],
        }),
    };

    if (slimMode) {
        const items = await prisma.item.findMany({
            where,
            take: MAX_ITEM_SLIM,
            orderBy: { name: 'asc' },
            select: { id: true, name: true, barcode: true },
        });
        return { items, slim: true };
    }

    const { skip, take } = parseItemPagination(query.skip, query.take, 20);
    const include = catalogMode ? ITEM_CATALOG_INCLUDE : ITEM_INCLUDE;

    const [items, total] = await Promise.all([
        prisma.item.findMany({
            where,
            skip,
            take,
            orderBy: { name: 'asc' },
            include,
        }),
        prisma.item.count({ where }),
    ]);

    const obStatus = await settingService.getObStatus(tenantId);
    const draftAgg =
        obStatus === 'OPEN' && items.length > 0
            ? await loadOpeningBalanceDraftAgg(tenantId, items.map((i) => i.id))
            : new Map();
    const enrichCtx = { obStatus, draftAgg };

    const enrichedItems = await Promise.all(
        items.map(async (it) => attachDisplayImageUrl(enrichItemWithOpeningFields(it, enrichCtx)))
    );

    return {
        items: enrichedItems,
        total,
        skip,
        take,
    };
};

/**
 * Items receivable at a warehouse (GRN destination): in stock there, default store = location,
 * or item category is linked to this location via LocationCategory.
 * Each row includes `currentStock` (qty on hand at this location, 0 if no balance row).
 */
const getItemsByLocationId = async (tenantId, locationId, query = {}) => {
    if (!uuidValidate(locationId)) throw badRequest('Invalid locationId');

    const location = await prisma.location.findFirst({
        where: { id: locationId, tenantId },
        select: { id: true },
    });
    if (!location) {
        const e = new Error('Location not found');
        e.statusCode = 404;
        throw e;
    }

    const { search } = query;
    const term = search && String(search).trim() ? String(search).trim() : '';

    const locationOr = [
        { stockBalances: { some: { locationId } } },
        { defaultStoreId: locationId },
        { category: { locationCategories: { some: { locationId } } } },
    ];

    const where = {
        tenantId,
        isActive: true,
        AND: [
            { OR: locationOr },
            ...(term
                ? [{
                    OR: [
                        { name: { contains: term, mode: 'insensitive' } },
                        { barcode: { contains: term, mode: 'insensitive' } },
                        { code: { contains: term, mode: 'insensitive' } },
                    ],
                }]
                : []),
        ],
    };

    let take = parseInt(query.take, 10);
    if (!Number.isFinite(take) || take < 1) take = 500;
    take = Math.min(take, 1000);

    const items = await prisma.item.findMany({
        where,
        orderBy: { name: 'asc' },
        take,
        include: {
            ...ITEM_CATALOG_INCLUDE,
            stockBalances: {
                where: { locationId },
                select: { qtyOnHand: true },
            },
        },
    });

    return items.map((it) => {
        const sb = it.stockBalances?.[0];
        const currentStock = sb && sb.qtyOnHand != null ? Number(sb.qtyOnHand) : 0;
        const { stockBalances, ...rest } = it;
        return { ...rest, currentStock };
    });
};

/**
 * Lightweight list-select source: all active items tied to this location (no pagination).
 * Includes stock-derived relation, default store relation, or location-category relation.
 */
const getAllItemsByLocationId = async (tenantId, locationId, query = {}) => {
    if (!uuidValidate(locationId)) throw badRequest('Invalid locationId');

    const location = await prisma.location.findFirst({
        where: { id: locationId, tenantId },
        select: { id: true },
    });
    if (!location) {
        const e = new Error('Location not found');
        e.statusCode = 404;
        throw e;
    }

    const { search } = query;
    const term = search && String(search).trim() ? String(search).trim() : '';

    const where = {
        tenantId,
        isActive: true,
        AND: [
            {
                OR: [
                    { stockBalances: { some: { locationId } } },
                    { defaultStoreId: locationId },
                    { category: { locationCategories: { some: { locationId } } } },
                ],
            },
            ...(term
                ? [{
                    OR: [
                        { name: { contains: term, mode: 'insensitive' } },
                        { barcode: { contains: term, mode: 'insensitive' } },
                        { code: { contains: term, mode: 'insensitive' } },
                    ],
                }]
                : []),
        ],
    };

    const items = await prisma.item.findMany({
        where,
        orderBy: { name: 'asc' },
        select: {
            id: true,
            name: true,
            code: true,
            barcode: true,
            stockBalances: {
                where: { locationId },
                select: { qtyOnHand: true },
            },
        },
    });

    return items.map((it) => ({
        id: it.id,
        name: it.name,
        code: it.code,
        barcode: it.barcode,
        currentStock: it.stockBalances?.[0]?.qtyOnHand != null ? Number(it.stockBalances[0].qtyOnHand) : 0,
    }));
};

// ── GET BY ID ──────────────────────────────────────────────────────────────────
const getItemById = async (id, tenantId) => {
    const item = await prisma.item.findFirst({
        where: { id, tenantId },
        include: {
            ...ITEM_INCLUDE,
            stockBalances: { include: { location: { select: { id: true, name: true } } } },
        },
    });
    if (!item) throw notFound();
    const ctx = await buildItemEnrichmentCtx(tenantId, [id]);
    return attachDisplayImageUrl(enrichItemWithOpeningFields(item, ctx));
};

// ── UPDATE ─────────────────────────────────────────────────────────────────────
const updateItem = async (id, data, tenantId, userId = null) => {
    const existing = await getItemById(id, tenantId);
    const obStatus = await settingService.getObStatus(tenantId);

    const {
        itemUnits,
        openingQuantity,
        displayTotalQty: _displayTotalQty,
        ...bodyRest
    } = data;

    const mainData = pickWhitelistedItemPayload(bodyRest);
    const hasOpeningQtyInPayload = Object.prototype.hasOwnProperty.call(data, 'openingQuantity');
    const openingQtyTarget = hasOpeningQtyInPayload ? Number(openingQuantity) : null;

    if (obStatus === 'FINALIZED') {
        const hasUnitPriceInPayload = Object.prototype.hasOwnProperty.call(data, 'unitPrice');
        const hasItemUnitsInPayload = Object.prototype.hasOwnProperty.call(data, 'itemUnits');
        if (hasUnitPriceInPayload || hasItemUnitsInPayload || hasOpeningQtyInPayload) {
            throw badRequest(
                'Cannot modify unit price, base unit, or opening quantity after Opening Balance finalization. '
                + 'You can still update descriptive fields.'
            );
        }
    }

    if (hasOpeningQtyInPayload) {
        if (obStatus !== 'OPEN') {
            throw badRequest('Opening quantity can only be edited while Opening Balance is in OPEN status.');
        }
        if (!Number.isFinite(openingQtyTarget) || openingQtyTarget < 0) {
            throw badRequest('openingQuantity must be a valid number greater than or equal to 0.');
        }
        if (!userId) {
            throw badRequest('User context is required to update opening quantity.');
        }
    }

    if (mainData.categoryId) {
        const cat = await prisma.category.findFirst({ where: { id: mainData.categoryId, tenantId } });
        if (!cat) throw badRequest('Category not found in this tenant.');
    }

    if (mainData.departmentId) {
        const dept = await prisma.department.findFirst({ where: { id: mainData.departmentId, tenantId } });
        if (!dept) throw badRequest('Department not found in this tenant.');
    }

    // Validate store belongs to department
    const storeId = mainData.defaultStoreId || existing.defaultStoreId;
    const deptId = mainData.departmentId || existing.departmentId;
    if (storeId && deptId) {
        const store = await prisma.location.findFirst({ where: { id: storeId, tenantId } });
        if (store && store.departmentId && store.departmentId !== deptId) {
            throw badRequest('Default store does not belong to the selected department.');
        }
    }

    if (mainData.name) {
        const dup = await prisma.item.findFirst({ where: { name: mainData.name, tenantId, id: { not: id } } });
        if (dup) throw badRequest(`Item name '${mainData.name}' already exists.`);
    }

    if (mainData.barcode) {
        const dup = await prisma.item.findFirst({ where: { barcode: mainData.barcode, tenantId, id: { not: id } } });
        if (dup) throw badRequest(`Barcode '${mainData.barcode}' already exists in this tenant.`);
    }

    // ── Unit Structure Lock ──────────────────────────────────────────────────
    // Block ALL unit modifications if stock > 0 in any location.
    // Protects inventory valuation integrity and historical quantity interpretation.
    if (itemUnits !== undefined) {
        validateItemUnits(itemUnits);

        // Check if units actually changed
        const existingUnits = await prisma.itemUnit.findMany({ where: { itemId: id } });
        const unitsChanged = _haveUnitsChanged(existingUnits, itemUnits);

        if (unitsChanged) {
            const activeStock = await prisma.stockBalance.count({
                where: { itemId: id, qtyOnHand: { gt: 0 } },
            });
            if (activeStock > 0) {
                throw badRequest(
                    'Cannot modify item units while stock exists. '
                    + 'Please zero out stock via adjustment/count or create a new item.'
                );
            }
        }
    }

    const openingQtySetup = Number(existing.openingQuantity ?? 0);
    const effectiveOpeningQtyForValidation = hasOpeningQtyInPayload ? openingQtyTarget : openingQtySetup;
    const effectiveUnitPrice =
        mainData.unitPrice !== undefined ? Number(mainData.unitPrice) : Number(existing.unitPrice ?? 0);
    if (obStatus === 'OPEN' && effectiveOpeningQtyForValidation > 0 && !(effectiveUnitPrice > 0)) {
        throw badRequest(
            'Unit price is required while this item has opening balance quantities in setup.'
        );
    }

    const result = await prisma.$transaction(async (tx) => {
        const movementService = hasOpeningQtyInPayload ? require('./movement.service') : null;

        // Replace units if provided
        if (itemUnits !== undefined) {
            await tx.itemUnit.deleteMany({ where: { itemId: id } });
            if (itemUnits.length > 0) {
                await tx.itemUnit.createMany({
                    data: itemUnits.map(u => ({
                        itemId: id,
                        unitId: u.unitId,
                        unitType: u.unitType,
                        conversionRate: u.conversionRate,
                        isDefault: u.unitType === 'BASE',
                        tenantId,
                    })),
                });
            }
        }

        let row;
        if (Object.keys(mainData).length > 0) {
            row = await tx.item.update({
                where: { id },
                data: mainData,
                include: ITEM_INCLUDE,
            });
        } else {
            row = await tx.item.findFirst({ where: { id, tenantId }, include: ITEM_INCLUDE });
        }

        // During OPEN, draft OB lines value the item at catalog `unitPrice` (single source of truth).
        if (obStatus === 'OPEN' && Object.prototype.hasOwnProperty.call(mainData, 'unitPrice')) {
            const newPrice = Number(mainData.unitPrice);
            if (Number.isFinite(newPrice) && newPrice > 0) {
                const lines = await tx.movementLine.findMany({
                    where: {
                        itemId: id,
                        document: { tenantId, movementType: 'OPENING_BALANCE', status: 'DRAFT' },
                    },
                    select: { id: true, qtyInBaseUnit: true },
                });
                for (const ln of lines) {
                    const q = Number(ln.qtyInBaseUnit ?? 0);
                    await tx.movementLine.update({
                        where: { id: ln.id },
                        data: {
                            unitCost: newPrice,
                            totalValue: (Number.isFinite(q) ? q : 0) * newPrice,
                        },
                    });
                }
            }
        }

        if (hasOpeningQtyInPayload) {
            const locationId = row.defaultStoreId;
            if (!locationId) {
                throw badRequest('A default store (location) is required to set opening quantity.');
            }

            const unitCost = Number(row.unitPrice ?? existing.unitPrice ?? 0);
            if (openingQtyTarget > 0 && !(unitCost > 0)) {
                throw badRequest('Unit price is required when opening quantity is greater than 0.');
            }

            if (openingQtyTarget > 0) {
                // Keep OPEN draft totals in sync with overwrite behavior:
                // item-level openingQuantity edit is treated as the final total target.
                // Remove any non-default-store draft lines for this item to avoid stale sums.
                await tx.movementLine.deleteMany({
                    where: {
                        itemId: id,
                        locationId: { not: locationId },
                        document: {
                            tenantId,
                            movementType: 'OPENING_BALANCE',
                            status: 'DRAFT',
                        },
                    },
                });

                // Keep exactly one draft line for this item/location so OPEN UI sum matches draft total.
                await tx.movementLine.deleteMany({
                    where: {
                        itemId: id,
                        locationId,
                        document: {
                            tenantId,
                            movementType: 'OPENING_BALANCE',
                            status: 'DRAFT',
                        },
                    },
                });

                const tenantDraftDoc = await tx.movementDocument.findFirst({
                    where: {
                        tenantId,
                        movementType: 'OPENING_BALANCE',
                        status: 'DRAFT',
                    },
                    orderBy: { createdAt: 'asc' },
                    select: { id: true },
                });

                if (tenantDraftDoc) {
                    await tx.movementLine.create({
                        data: {
                            documentId: tenantDraftDoc.id,
                            itemId: id,
                            locationId,
                            qtyRequested: openingQtyTarget,
                            qtyInBaseUnit: openingQtyTarget,
                            unitCost,
                            totalValue: openingQtyTarget * unitCost,
                        },
                    });
                } else {
                    await movementService.createMovementDraft(
                        {
                            movementType: 'OPENING_BALANCE',
                            documentDate: new Date().toISOString(),
                            destLocationId: locationId,
                            notes: `Opening quantity synced from item update — ${row.name}`,
                            lines: [
                                {
                                    itemId: id,
                                    locationId,
                                    qtyRequested: openingQtyTarget,
                                    unitCost,
                                    totalValue: openingQtyTarget * unitCost,
                                },
                            ],
                        },
                        tenantId,
                        userId,
                        tx
                    );
                }
            } else {
                // For zero target, ensure no OPEN draft lines remain for this item in any location.
                await tx.movementLine.deleteMany({
                    where: {
                        itemId: id,
                        document: {
                            tenantId,
                            movementType: 'OPENING_BALANCE',
                            status: 'DRAFT',
                        },
                    },
                });
            }
        }

        return row;
    });

    return enrichSingleItemForResponse(result, tenantId);
};

// ── Helper: Check if item units actually changed ──────────────────────────────
function _haveUnitsChanged(existingUnits, newUnits) {
    if (existingUnits.length !== newUnits.length) return true;
    const normalize = (u) => `${u.unitId}|${u.unitType}|${Number(u.conversionRate)}`;
    const existingSet = new Set(existingUnits.map(normalize));
    return newUnits.some(u => !existingSet.has(normalize(u)));
}

// ── UPDATE IMAGE ───────────────────────────────────────────────────────────────
// `newKey` is whatever storage.put produced (legacy `/uploads/...` under local
// driver, tenant-scoped `tenants/.../...` under r2). `oldKey` is fire-and-forget.
const updateItemImage = async (id, tenantId, newKey, oldKey) => {
    const { deleteFile } = require('../middleware/upload.middleware');

    if (oldKey && oldKey !== newKey) {
        await deleteFile(oldKey);
    }

    const updated = await prisma.item.update({
        where: { id },
        data: { imageUrl: newKey },
        include: ITEM_INCLUDE,
    });
    return enrichSingleItemForResponse(updated, tenantId);
};

// ── SOFT DELETE ────────────────────────────────────────────────────────────────
const deleteItem = async (id, tenantId) => {
    await getItemById(id, tenantId);
    const obStatus = await settingService.getObStatus(tenantId);

    if (obStatus === 'OPEN') {
        // During OPEN, physical stock is not posted yet; drafts live on movement_lines only.
        return prisma.$transaction(async (tx) => {
            await tx.movementLine.deleteMany({ where: { itemId: id } });
            await tx.stockBalance.deleteMany({ where: { itemId: id, tenantId } });
            await tx.inventoryLedger.deleteMany({ where: { itemId: id, tenantId } });
            return tx.item.delete({ where: { id } });
        });
    }

    const stockCount = await prisma.stockBalance.count({
        where: { itemId: id, qtyOnHand: { gt: 0 } },
    });
    if (stockCount > 0 || obStatus === 'FINALIZED') {
        throw badRequest(
            'Cannot delete item while stock exists or after Opening Balance finalization. '
            + 'Use isActive: false instead.'
        );
    }

    return prisma.item.delete({ where: { id } });
};

// ── TOGGLE ACTIVE ──────────────────────────────────────────────────────────────
const toggleActive = async (id, tenantId) => {
    const item = await getItemById(id, tenantId);
    const toggled = await prisma.item.update({
        where: { id },
        data: { isActive: !item.isActive },
        include: ITEM_INCLUDE,
    });
    return enrichSingleItemForResponse(toggled, tenantId);
};

// ── GET ITEM UNITS ─────────────────────────────────────────────────────────────
const getItemUnits = async (id, tenantId) => {
    await getItemById(id, tenantId);
    return prisma.itemUnit.findMany({
        where: { itemId: id },
        include: { unit: { select: { id: true, name: true, abbreviation: true } } },
        orderBy: { unitType: 'asc' },
    });
};

// ── UPDATE ITEM UNITS ──────────────────────────────────────────────────────────
const updateItemUnits = async (id, tenantId, itemUnits) => {
    await getItemById(id, tenantId);
    validateItemUnits(itemUnits);

    return prisma.$transaction(async (tx) => {
        await tx.itemUnit.deleteMany({ where: { itemId: id } });
        if (itemUnits.length > 0) {
            await tx.itemUnit.createMany({
                data: itemUnits.map(u => ({
                    itemId: id,
                    unitId: u.unitId,
                    unitType: u.unitType,
                    conversionRate: u.conversionRate,
                    isDefault: u.unitType === 'BASE',
                    tenantId,
                })),
            });
        }
        return tx.itemUnit.findMany({
            where: { itemId: id },
            include: { unit: { select: { id: true, name: true, abbreviation: true } } },
        });
    });
};

// ── EXCEL IMPORT: PARSE & PREVIEW ─────────────────────────────────────────────
/**
 * Excel "Unit Price" → `item.unitPrice` on confirm and `unitCost` on each DRAFT OPENING_BALANCE line.
 * `openingQuantityTotal` per row = sum of quantities in all columns that resolve to active locations
 * (matches API `openingQuantity` / `displayTotalQty` after import during OPEN phase).
 */
const parseImportFile = async (fileBufferOrPath, tenantId, options = {}) => {
    const asOpeningBalance = Boolean(options.asOpeningBalance);
    // Accept either a Buffer (new multer memoryStorage path) or a string filesystem
    // path (legacy). The test harness in src/services/item.service.test.js passes
    // `rows` directly and bypasses this branch altogether.
    const wb = Buffer.isBuffer(fileBufferOrPath)
        ? XLSX.read(fileBufferOrPath, { type: 'buffer' })
        : XLSX.readFile(fileBufferOrPath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (rows.length === 0) throw badRequest('The uploaded file has no data rows.');
    if (rows.length > 1000) throw badRequest('Maximum 1000 rows per import.');

    // Fetch lookup data once
    const [categories, units, departments, locations, suppliers] = await Promise.all([
        prisma.category.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true } }),
        prisma.unit.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true, abbreviation: true } }),
        prisma.department.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true } }),
        prisma.location.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true, departmentId: true } }),
        prisma.supplier.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true } }),
    ]);

    const catMap = new Map(categories.map(c => [c.name.toLowerCase(), c.id]));
    const unitNameMap = new Map(units.map(u => [u.name.toLowerCase(), u.id]));
    const unitAbbreviationMap = new Map(
        units
            .filter(u => u.abbreviation)
            .map(u => [String(u.abbreviation).toLowerCase(), u.id])
    );
    const deptMap = new Map(departments.map(d => [d.name.toLowerCase(), d.id]));
    const supplierMap = new Map(suppliers.map(s => [s.name.toLowerCase(), s.id]));

    // Detect fixed vs dynamic (store) columns — headers not in this set are treated as
    // location columns only if they resolve to an active location; otherwise ignored.
    const FIXED_COLUMNS = new Set([
        'name', 'barcode', 'code', 'item code', 'sku', 'department', 'category', 'base unit', 'unit price',
        'default store', 'defaultstore', 'vendor', 'supplier', 'description', 'image url', 'imageurl',
        'reorder point', 'reorder qty', 'reorderpoint', 'reorderqty', 'is active', 'active',
    ]);

    const allHeaders = rows.length > 0 ? Object.keys(rows[0]) : [];
    const storeHeaders = allHeaders.filter(h => !FIXED_COLUMNS.has(h.toLowerCase()));
    // ── Normalized location matching ─────────────────────────────────────────
    // Handles: exact match, case differences, H&B/H&K → F&B/HK normalization,
    // truncated names (Excel cuts long headers to ~12 chars), trailing dots
    const normalize = (s) => s
        .toLowerCase()
        .replace(/h&b\./gi, 'f&b.')   // H&B.Horizon → F&B.Horizon
        .replace(/h&b\s/gi, 'f&b ')   // H&B Store → F&B Store
        .replace(/h&k\./gi, 'hk.')    // H&K.Store → HK.Store
        .replace(/h&k\s/gi, 'hk ')    // H&K Store → HK Store
        .replace(/\.+$/, '')           // strip trailing dots
        .replace(/\s+/g, ' ')
        .trim();

    // Build a normalized lookup map: normalizedName → { id, originalName }
    const locNormMap = new Map();
    for (const loc of locations) {
        locNormMap.set(normalize(loc.name), { id: loc.id, departmentId: loc.departmentId, name: loc.name });
    }

    // Try to resolve a header → location, with fuzzy fallback
    const resolveLocation = (header) => {
        const normHeader = normalize(header);

        // 1) Exact normalized match
        if (locNormMap.has(normHeader)) return locNormMap.get(normHeader);

        // 2) Prefix match — DB name starts with the (possibly truncated) header
        for (const [normName, locInfo] of locNormMap.entries()) {
            if (normName.startsWith(normHeader) || normHeader.startsWith(normName)) {
                return locInfo;
            }
        }

        // 3) Contains match — useful for partial overlap
        for (const [normName, locInfo] of locNormMap.entries()) {
            const shorter = normHeader.length < normName.length ? normHeader : normName;
            const longer  = normHeader.length < normName.length ? normName  : normHeader;
            if (shorter.length >= 4 && longer.includes(shorter)) {
                return locInfo;
            }
        }

        return null;
    };

    const storeColumnNames = [];
    /** Headers that are not fixed fields and do not match any active location (ignored). */
    const unmappedLocationHeaders = [];

    for (const header of storeHeaders) {
        const locInfo = resolveLocation(header);
        if (locInfo) {
            storeColumnNames.push({ header, locationId: locInfo.id });
        } else {
            unmappedLocationHeaders.push(header);
        }
    }

    // Preload existing DB items for fast "exists in DB" checks
    const incomingNames = [...new Set(
        rows
            .map(row => String(row['Name'] || row['name'] || '').trim().toLowerCase())
            .filter(Boolean)
    )];
    const existingItems = incomingNames.length > 0
        ? await prisma.item.findMany({
            where: { tenantId },
            select: { id: true, name: true },
        })
        : [];
    const existingByNameMap = new Map(
        existingItems
            .filter(item => item.name)
            .map(item => [String(item.name).toLowerCase(), item])
    );

    // In-file duplicate detection
    const seenNames = new Set();

    const preview = rows.map((row, idx) => {
        const issues = [];
        const rowNum = idx + 2;
        const addIssue = (field, message, severity, code) => {
            issues.push({ field, message, severity, code });
        };

        const name = String(row['Name'] || row['name'] || '').trim();
        const unitPrice = parseExcelNumber(row['Unit Price'] || row['unitPrice'] || row['unit_price'] || 0);
        const catName = String(row['Category'] || row['category'] || '').trim();
        const baseUnit = String(row['Base Unit'] || row['baseUnit'] || row['base_unit'] || '').trim();
        const deptName = String(row['Department'] || row['department'] || '').trim();
        const vendorName = String(row['Vendor'] || row['vendor'] || row['Supplier'] || row['supplier'] || '').trim();

        if (!name) addIssue('name', 'Name is required', 'error', 'REQUIRED');
        if (isNaN(unitPrice) || unitPrice < 0) addIssue('unitPrice', 'Invalid unit price', 'error', 'INVALID_NUMBER');

        const normalizedName = name.toLowerCase();
        if (name) {
            if (seenNames.has(normalizedName)) {
                addIssue('name', `Name '${name}' is duplicated in file`, 'error', 'DUPLICATE_IN_FILE');
            } else {
                seenNames.add(normalizedName);
            }
        }

        const categoryId = catName ? catMap.get(catName.toLowerCase()) : undefined;
        if (catName && !categoryId) addIssue('category', `Category '${catName}' not found`, 'error', 'NOT_FOUND');

        const supplierId = vendorName ? supplierMap.get(vendorName.toLowerCase()) : undefined;
        if (vendorName && !supplierId) addIssue('vendor', `Vendor '${vendorName}' not found`, 'error', 'NOT_FOUND');

        let baseUnitId = undefined;
        if (baseUnit) {
            const unitCodeMatch = baseUnit.match(/\(([^)]+)\)/);
            if (unitCodeMatch?.[1]) {
                const unitCode = unitCodeMatch[1].trim().toLowerCase();
                baseUnitId = unitAbbreviationMap.get(unitCode);
            }
            if (!baseUnitId) {
                const cleanedUnit = baseUnit.replace(/\s*\(.*\)\s*$/, '').trim();
                baseUnitId = unitNameMap.get(cleanedUnit.toLowerCase());
            }
            if (!baseUnitId) addIssue('baseUnit', `Unit '${baseUnit}' not found`, 'error', 'NOT_FOUND');
        }

        const departmentId = deptName ? deptMap.get(deptName.toLowerCase()) : undefined;
        if (deptName && !departmentId) addIssue('department', `Department '${deptName}' not found`, 'error', 'NOT_FOUND');
        if (!deptName) addIssue('department', 'Department is required', 'error', 'REQUIRED');

        // DB existence / update intent (match by name only; barcodes are system-generated)
        const existingByName = name ? existingByNameMap.get(normalizedName) : null;
        const matchedExisting = existingByName || null;
        const isUpdate = Boolean(matchedExisting);
        if (isUpdate) {
            addIssue(
                'name',
                `Row matches existing item in DB (${matchedExisting.name}). Import will update it.`,
                'warning',
                'EXISTS_IN_DB'
            );
        }

        // Parse store quantities from dynamic columns
        const storeQuantities = {};
        let firstStoreWithQty = null;
        for (const { header, locationId } of storeColumnNames) {
            const rawQty = row[header];
            const qty = parseExcelNumber(rawQty || 0);
            const hasRawValue = rawQty !== null && rawQty !== undefined && String(rawQty).trim() !== '';
            if (hasRawValue && Number.isNaN(qty)) {
                addIssue(`store__${header}`, `Invalid quantity in store column '${header}'`, 'error', 'INVALID_NUMBER');
                continue;
            }
            if (!isNaN(qty) && qty > 0) {
                storeQuantities[locationId] = qty;
                if (!firstStoreWithQty) firstStoreWithQty = locationId;
            }
        }

        let openingQuantityTotal = 0;
        for (const q of Object.values(storeQuantities)) {
            const n = Number(q);
            if (Number.isFinite(n) && n > 0) openingQuantityTotal += n;
        }
        openingQuantityTotal = Math.round(openingQuantityTotal * 10000) / 10000;

        if (asOpeningBalance && openingQuantityTotal > 0 && !(Number(unitPrice) > 0)) {
            addIssue(
                'unitPrice',
                'Unit price is required when opening quantities are provided across locations.',
                'error',
                'OB_REQUIRES_UNIT_PRICE'
            );
        }

        const defaultStoreId = firstStoreWithQty || null;
        const errors = issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message);

        return {
            rowNum,
            status: errors.length === 0 ? 'VALID' : 'ERROR',
            isUpdate,
            issues,
            errors,
            data: {
                name,
                unitPrice: isNaN(unitPrice) ? 0 : unitPrice,
                departmentId: departmentId || null,
                defaultStoreId,
                categoryId: categoryId || null,
                supplierId: supplierId || null,
                baseUnitId: baseUnitId || null,
                categoryName: catName || null,
                baseUnitName: baseUnit || null,
                deptName: deptName || null,
                vendorName: vendorName || null,
                storeQuantities,
                openingQuantityTotal,
                isUpdate,
            },
        };
    });

    const validCount = preview.filter(r => r.status === 'VALID').length;
    const invalidCount = preview.filter(r => r.status === 'ERROR').length;

    return {
        preview,
        total: rows.length,
        valid: validCount,
        invalid: invalidCount,
        storeColumns: storeColumnNames.map(s => s.header),
        unmappedLocationHeaders,
        /** @deprecated use unmappedLocationHeaders — kept for import UI compatibility */
        unknownColumns: unmappedLocationHeaders,
        ...(unmappedLocationHeaders.length > 0 && {
            parseWarnings: [
                `Columns not mapped to active locations (ignored): ${unmappedLocationHeaders.join(', ')}`,
            ],
        }),
        contractVersion: 'V2',
        summary: {
            asOpeningBalance,
            openingBalanceReason: {
                required: asOpeningBalance,
                message: asOpeningBalance ? 'Global reason is required for Opening Balance confirm step.' : null,
            },
            /** Row `data.openingQuantityTotal` sums mapped location columns; aligns with list `openingQuantity` in OPEN. */
            openingQtyIsSumOfMappedLocationColumns: true,
        },
    };
};

/**
 * Opening Balance Excel import: idempotent per (itemId + locationId).
 * - Updates an existing DRAFT OPENING_BALANCE line for that item+location if present.
 * - Otherwise appends a line to the tenant's oldest DRAFT OPENING_BALANCE document so
 *   multi-location import accumulates on one document; creates that document if none exist.
 * Caller must run inside prisma.$transaction and pass tx.
 */
const upsertOpeningBalanceForItemLocation = async (
    tx,
    {
        tenantId,
        itemId,
        locationId,
        targetQty,
        unitCost,
        userId,
        itemName,
    },
    movementService
) => {
    const qty = Number(targetQty);
    if (!(qty > 0) || !(Number(unitCost) > 0)) {
        throw new Error(`Invalid Opening Balance qty/unit price for "${itemName}" at location.`);
    }

    const txDate = new Date();
    const totalValue = qty * Number(unitCost);

    await checkOpeningBalanceAllowed(tenantId, txDate);

    const existingDraftLines = await tx.movementLine.findMany({
        where: {
            itemId,
            locationId,
            document: {
                tenantId,
                movementType: 'OPENING_BALANCE',
                status: 'DRAFT',
            },
        },
        include: {
            document: {
                select: { id: true, documentNo: true, createdAt: true },
            },
        },
        orderBy: [{ document: { createdAt: 'asc' } }, { id: 'asc' }],
    });

    const tenantDraftDoc = await tx.movementDocument.findFirst({
        where: {
            tenantId,
            movementType: 'OPENING_BALANCE',
            status: 'DRAFT',
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, documentNo: true },
    });

    // Canonical draft doc for this item+location line.
    // Preference: earliest draft doc already containing this item+location, otherwise tenant earliest draft doc.
    const canonicalDoc = existingDraftLines.length > 0
        ? {
            id: existingDraftLines[0].document.id,
            documentNo: existingDraftLines[0].document.documentNo,
        }
        : tenantDraftDoc;

    if (canonicalDoc) {
        // Aggressive pre-cleanup before insert (safer under concurrent updates).
        await tx.movementLine.deleteMany({
            where: {
                itemId,
                locationId,
                document: {
                    tenantId,
                    movementType: 'OPENING_BALANCE',
                    status: 'DRAFT',
                },
            },
        });

        const createdLine = await tx.movementLine.create({
            data: {
                documentId: canonicalDoc.id,
                itemId,
                locationId,
                qtyRequested: qty,
                qtyInBaseUnit: qty,
                unitCost,
                totalValue,
            },
        });

        // Post-cleanup: keep exactly one line for this item+location across all OB DRAFT docs.
        // This protects against double-submit/concurrent requests that might insert duplicates.
        await tx.movementLine.deleteMany({
            where: {
                itemId,
                locationId,
                id: { not: createdLine.id },
                document: {
                    tenantId,
                    movementType: 'OPENING_BALANCE',
                    status: 'DRAFT',
                },
            },
        });

        await tx.movementDocument.update({
            where: { id: canonicalDoc.id },
            data: {
                documentDate: txDate,
                notes: `Opening Balance import (multi-location) — includes ${itemName}`,
            },
        });

        return {
            kind: existingDraftLines.length > 0 ? 'draft_updated' : 'draft_line_added',
            documentNo: canonicalDoc.documentNo,
        };
    }

    const obDoc = await movementService.createMovementDraft(
        {
            movementType: 'OPENING_BALANCE',
            documentDate: txDate.toISOString(),
            destLocationId: locationId,
            notes: `Opening Balance import (multi-location) — includes ${itemName}`,
            lines: [
                {
                    itemId,
                    locationId,
                    qtyRequested: qty,
                    unitCost,
                    totalValue: totalValue,
                },
            ],
        },
        tenantId,
        userId,
        tx
    );

    return { kind: 'draft_created', documentNo: obDoc.documentNo };
};

// ── EXCEL IMPORT: CONFIRM ─────────────────────────────────────────────────────
const confirmImport = async (rows, tenantId, createdBy, asOpeningBalance = false) => {
    const movementService = require('./movement.service');

    let inserted = 0, updated = 0, failed = 0;
    const failures = [];
    const obDocuments = []; // OB draft document numbers (official posting happens on finalize)
    let obLocationUpdates = 0;

    for (const row of rows) {
        if (row.status === 'ERROR') {
            failed++;
            failures.push({ rowNum: row.rowNum, errors: row.errors });
            continue;
        }

        const { name, unitPrice, departmentId, defaultStoreId, categoryId, supplierId, baseUnitId, storeQuantities } = row.data;

        try {
            const txResult = await prisma.$transaction(async (tx) => {
                // Check if item exists
                const existing = await tx.item.findFirst({ where: { name, tenantId } });
                let itemId;
                let wasInserted = false;
                let wasUpdated = false;
                const obDocNosThisRow = [];
                let obLocationsUpdatedThisRow = 0;

                if (existing) {
                    await tx.item.update({
                        where: { id: existing.id },
                        data: {
                            ...(unitPrice !== undefined && { unitPrice }),
                            ...(departmentId && { departmentId }),
                            ...(defaultStoreId && { defaultStoreId }),
                            ...(categoryId && { categoryId }),
                            ...(supplierId && { supplierId }),
                        },
                    });
                    itemId = existing.id;
                    wasUpdated = true;
                } else {
                    const finalBarcode = Math.floor(100000000000 + Math.random() * 900000000000).toString();
                    const created = await tx.item.create({
                        data: {
                            name, unitPrice, categoryId,
                            barcode: finalBarcode,
                            tenantId,
                            ...(departmentId && { departmentId }),
                            ...(defaultStoreId && { defaultStoreId }),
                            ...(supplierId && { supplierId }),
                        },
                    });
                    itemId = created.id;
                    wasInserted = true;

                    // Add base unit if provided
                    if (baseUnitId) {
                        await tx.itemUnit.create({
                            data: {
                                itemId: created.id,
                                unitId: baseUnitId,
                                unitType: 'BASE',
                                conversionRate: 1,
                                isDefault: true,
                                tenantId,
                            },
                        });
                    }
                }

                // ── Opening Balance: idempotent per (itemId + locationId) ──
                if (asOpeningBalance && storeQuantities && Object.keys(storeQuantities).length > 0) {
                    if (!(Number(unitPrice) > 0)) {
                        throw new Error(`Opening Balance requires a valid unit price. Item "${name}" has unitPrice = ${unitPrice || 0}. Please add a unit price before importing as Opening Balance.`);
                    }

                    for (const [locationId, qty] of Object.entries(storeQuantities)) {
                        const result = await upsertOpeningBalanceForItemLocation(
                            tx,
                            {
                                tenantId,
                                itemId,
                                locationId,
                                targetQty: qty,
                                unitCost: unitPrice,
                                userId: createdBy,
                                itemName: name,
                            },
                            movementService
                        );
                        if (
                            (result.kind === 'draft_created'
                                || result.kind === 'draft_updated'
                                || result.kind === 'draft_line_added')
                            && result.documentNo
                        ) {
                            obDocNosThisRow.push(result.documentNo);
                        }
                        if (result.kind === 'draft_updated') {
                            obLocationsUpdatedThisRow += 1;
                        }
                    }
                }

                return { wasInserted, wasUpdated, obDocNosThisRow, obLocationsUpdatedThisRow };
            });

            if (txResult.wasInserted) inserted++;
            if (txResult.wasUpdated) updated++;
            for (const no of txResult.obDocNosThisRow || []) {
                obDocuments.push(no);
            }
            obLocationUpdates += txResult.obLocationsUpdatedThisRow || 0;
        } catch (err) {
            failed++;
            failures.push({ rowNum: row.rowNum, errors: [err.message] });
        }
    }

    return {
        inserted, updated, failed, failures,
        ...(asOpeningBalance && {
            obDocuments,
            obCount: obDocuments.length,
            obLocationUpdates,
        }),
    };
};
// ── BULK UPLOAD IMAGES (ZIP) ──────────────────────────────────────────────────
// Accepts the raw ZIP bytes (multer.memoryStorage) and pipes each matched image
// through the storage provider, so the flow is identical whether bytes land on
// local disk or in R2.
const bulkUploadImages = async (zipBuffer, tenantId) => {
    const AdmZip = require('adm-zip');
    const { putBuffer, buildItemImageKey, deleteFile } = require('../middleware/upload.middleware');

    const zip = new AdmZip(Buffer.isBuffer(zipBuffer) ? zipBuffer : undefined);
    const entries = zip.getEntries();

    const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const MIME_BY_EXT = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
    };
    const results = { matched: 0, skipped: 0, errors: [], details: [] };

    const items = await prisma.item.findMany({
        where: { tenantId },
        select: { id: true, barcode: true, name: true, imageUrl: true },
    });

    const barcodeMap = new Map();
    for (const item of items) {
        if (item.barcode) barcodeMap.set(item.barcode.toLowerCase(), item);
    }

    for (const entry of entries) {
        if (entry.isDirectory || entry.entryName.startsWith('__MACOSX') || entry.entryName.startsWith('.')) continue;

        const filename = path.basename(entry.entryName);
        const ext = path.extname(filename).toLowerCase();
        const nameWithoutExt = path.basename(filename, ext).trim();

        if (!IMAGE_EXTS.includes(ext)) {
            results.skipped++;
            results.details.push({ file: filename, status: 'skipped', reason: 'Not an image file' });
            continue;
        }

        const item = barcodeMap.get(nameWithoutExt.toLowerCase());
        if (!item) {
            results.skipped++;
            results.details.push({ file: filename, status: 'skipped', reason: `No item with barcode "${nameWithoutExt}"` });
            continue;
        }

        try {
            const buffer = entry.getData();
            const key = buildItemImageKey(tenantId, filename, item.id);
            await putBuffer(key, {
                buffer,
                size: buffer.length,
                mimetype: MIME_BY_EXT[ext] || 'application/octet-stream',
                originalname: filename,
            });

            // Delete old image if one was set (best-effort; no-op under r2 for legacy paths).
            if (item.imageUrl && item.imageUrl !== key) {
                deleteFile(item.imageUrl).catch(() => { /* ignore */ });
            }

            await prisma.item.update({
                where: { id: item.id },
                data: { imageUrl: key },
            });

            results.matched++;
            results.details.push({ file: filename, status: 'matched', itemName: item.name, barcode: item.barcode });
        } catch (err) {
            results.errors.push({ file: filename, error: err.message });
            results.details.push({ file: filename, status: 'error', reason: err.message });
        }
    }

    return results;
};

module.exports = {
    checkItemCreationRequirements,
    createItem,
    getItems,
    getItemsByLocationId,
    getAllItemsByLocationId,
    getItemById,
    updateItem,
    updateItemImage,
    deleteItem,
    toggleActive,
    getItemUnits,
    updateItemUnits,
    parseImportFile,
    confirmImport,
    bulkUploadImages,
};
