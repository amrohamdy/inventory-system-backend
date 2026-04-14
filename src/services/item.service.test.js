const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const servicePath = path.resolve(__dirname, './item.service.js');

function loadServiceWithMocks({
    rows,
    categories = [],
    units = [],
    departments = [],
    locations = [],
    suppliers = [],
    items = [],
}) {
    const prismaMock = {
        category: { findMany: async () => categories },
        unit: { findMany: async () => units },
        department: { findMany: async () => departments },
        location: { findMany: async () => locations },
        supplier: { findMany: async () => suppliers },
        item: { findMany: async () => items },
    };

    const originalLoad = Module._load;
    Module._load = function patchedLoader(request, parent, isMain) {
        if (request === '@prisma/client') {
            return { PrismaClient: function PrismaClient() { return prismaMock; } };
        }
        if (request === 'xlsx') {
            return {
                readFile: () => ({ SheetNames: ['Items'], Sheets: { Items: {} } }),
                utils: { sheet_to_json: () => rows },
            };
        }
        if (request === './audit.service') return {};
        if (request === './setting.service') return {};
        return originalLoad(request, parent, isMain);
    };

    delete require.cache[servicePath];
    const service = require(servicePath);
    Module._load = originalLoad;
    return service;
}

const SAMPLE_DEPT_UUID = '123e4567-e89b-12d3-a456-426614174000';

function loadServiceForListQueries(prismaMock, settingServiceOverrides = {}) {
    const prismaMerged = {
        movementLine: { groupBy: async () => [] },
        ...prismaMock,
    };
    const settingService = {
        getObStatus: async () => 'FINALIZED',
        ...settingServiceOverrides,
    };
    const originalLoad = Module._load;
    Module._load = function patchedLoader(request, parent, isMain) {
        if (request === '@prisma/client') {
            return { PrismaClient: function PrismaClient() { return prismaMerged; } };
        }
        if (request === 'xlsx') {
            return {
                readFile: () => ({}),
                utils: { sheet_to_json: () => [] },
            };
        }
        if (request === './audit.service') return {};
        if (request === './setting.service') {
            return settingService;
        }
        if (request === './periodGuard.service') return {};
        return originalLoad(request, parent, isMain);
    };

    delete require.cache[servicePath];
    const service = require(servicePath);
    Module._load = originalLoad;
    return service;
}

test('parseImportFile parses comma-formatted numbers correctly', async () => {
    const service = loadServiceWithMocks({
        rows: [
            {
                Name: 'Soap',
                Department: 'Housekeeping',
                Category: 'Amenities',
                Vendor: 'Best Vendor',
                'Base Unit': 'Bag (bag)',
                'Unit Price': '1,200.50',
                'Main Store': '1,200',
            },
        ],
        categories: [{ id: 'cat-1', name: 'Amenities' }],
        units: [{ id: 'unit-bag', name: 'Bag', abbreviation: 'bag' }],
        departments: [{ id: 'dep-1', name: 'Housekeeping' }],
        locations: [{ id: 'loc-1', name: 'Main Store', departmentId: 'dep-1' }],
        suppliers: [{ id: 'sup-1', name: 'Best Vendor' }],
    });

    const result = await service.parseImportFile('/tmp/fake.xlsx', 'tenant-1');
    assert.equal(result.preview[0].status, 'VALID');
    assert.equal(result.preview[0].data.unitPrice, 1200.5);
    assert.equal(result.preview[0].data.storeQuantities['loc-1'], 1200);
    assert.equal(result.preview[0].data.openingQuantityTotal, 1200);
    assert.equal(result.preview[0].data.categoryName, 'Amenities');
    assert.equal(result.preview[0].data.baseUnitName, 'Bag (bag)');
});

test('parseImportFile extracts unit abbreviation from parentheses (Bag/Pcs)', async () => {
    const service = loadServiceWithMocks({
        rows: [
            {
                Name: 'Row A',
                Department: 'Housekeeping',
                Category: 'Amenities',
                Vendor: 'Best Vendor',
                'Base Unit': 'Bag (bag)',
                'Unit Price': '10',
                'Main Store': '2',
            },
            {
                Name: 'Row B',
                Department: 'Housekeeping',
                Category: 'Amenities',
                Vendor: 'Best Vendor',
                'Base Unit': 'Pcs (pcs)',
                'Unit Price': '12',
                'Main Store': '3',
            },
        ],
        categories: [{ id: 'cat-1', name: 'Amenities' }],
        // Names intentionally do not match "Bag"/"Pcs" to verify abbreviation-first matching.
        units: [
            { id: 'unit-bag', name: 'Packaging Bag', abbreviation: 'bag' },
            { id: 'unit-pcs', name: 'Pieces', abbreviation: 'pcs' },
        ],
        departments: [{ id: 'dep-1', name: 'Housekeeping' }],
        locations: [{ id: 'loc-1', name: 'Main Store', departmentId: 'dep-1' }],
        suppliers: [{ id: 'sup-1', name: 'Best Vendor' }],
    });

    const result = await service.parseImportFile('/tmp/fake.xlsx', 'tenant-1');
    assert.equal(result.preview[0].data.baseUnitId, 'unit-bag');
    assert.equal(result.preview[1].data.baseUnitId, 'unit-pcs');
    assert.equal(result.preview[0].status, 'VALID');
    assert.equal(result.preview[1].status, 'VALID');
});

test('parseImportFile ignores unknown dynamic store headers (parseWarnings, row stays valid)', async () => {
    const service = loadServiceWithMocks({
        rows: [
            {
                Name: 'Soap',
                Department: 'Housekeeping',
                Category: 'Amenities',
                Vendor: 'Best Vendor',
                'Base Unit': 'Bag (bag)',
                'Unit Price': '10',
                'Unknown Store Header': '5',
            },
        ],
        categories: [{ id: 'cat-1', name: 'Amenities' }],
        units: [{ id: 'unit-bag', name: 'Bag', abbreviation: 'bag' }],
        departments: [{ id: 'dep-1', name: 'Housekeeping' }],
        locations: [{ id: 'loc-1', name: 'Main Store', departmentId: 'dep-1' }],
        suppliers: [{ id: 'sup-1', name: 'Best Vendor' }],
    });

    const result = await service.parseImportFile('/tmp/fake.xlsx', 'tenant-1');
    assert.deepEqual(result.unmappedLocationHeaders, ['Unknown Store Header']);
    assert.ok(Array.isArray(result.parseWarnings));
    assert.equal(result.preview[0].status, 'VALID');
    assert.equal(result.preview[0].data.openingQuantityTotal, 0);
});

test('parseImportFile sums openingQuantityTotal across mapped location columns', async () => {
    const service = loadServiceWithMocks({
        rows: [
            {
                Name: 'Towel',
                Department: 'Housekeeping',
                Category: 'Amenities',
                Vendor: 'Best Vendor',
                'Base Unit': 'Bag (bag)',
                'Unit Price': '5',
                'Main Store': '10',
                'Second Store': '20',
            },
        ],
        categories: [{ id: 'cat-1', name: 'Amenities' }],
        units: [{ id: 'unit-bag', name: 'Bag', abbreviation: 'bag' }],
        departments: [{ id: 'dep-1', name: 'Housekeeping' }],
        locations: [
            { id: 'loc-1', name: 'Main Store', departmentId: 'dep-1' },
            { id: 'loc-2', name: 'Second Store', departmentId: 'dep-1' },
        ],
        suppliers: [{ id: 'sup-1', name: 'Best Vendor' }],
    });

    const result = await service.parseImportFile('/tmp/fake.xlsx', 'tenant-1');
    assert.equal(result.preview[0].status, 'VALID');
    assert.equal(result.preview[0].data.openingQuantityTotal, 30);
    assert.equal(result.preview[0].data.storeQuantities['loc-1'], 10);
    assert.equal(result.preview[0].data.storeQuantities['loc-2'], 20);
});

test('parseImportFile asOpeningBalance requires unit price when location qty > 0', async () => {
    const service = loadServiceWithMocks({
        rows: [
            {
                Name: 'Towel',
                Department: 'Housekeeping',
                Category: 'Amenities',
                Vendor: 'Best Vendor',
                'Base Unit': 'Bag (bag)',
                'Unit Price': '0',
                'Main Store': '5',
            },
        ],
        categories: [{ id: 'cat-1', name: 'Amenities' }],
        units: [{ id: 'unit-bag', name: 'Bag', abbreviation: 'bag' }],
        departments: [{ id: 'dep-1', name: 'Housekeeping' }],
        locations: [{ id: 'loc-1', name: 'Main Store', departmentId: 'dep-1' }],
        suppliers: [{ id: 'sup-1', name: 'Best Vendor' }],
    });

    const result = await service.parseImportFile('/tmp/fake.xlsx', 'tenant-1', { asOpeningBalance: true });
    assert.equal(result.preview[0].status, 'ERROR');
    assert.match(
        result.preview[0].errors.join(' '),
        /Unit price is required when opening quantities are provided across locations/
    );
});

test('parseImportFile returns row-level validation error for unknown vendor', async () => {
    const service = loadServiceWithMocks({
        rows: [
            {
                Name: 'Soap',
                Department: 'Housekeeping',
                Category: 'Amenities',
                Vendor: 'Missing Vendor',
                'Base Unit': 'Bag (bag)',
                'Unit Price': '10',
                'Main Store': '1',
            },
        ],
        categories: [{ id: 'cat-1', name: 'Amenities' }],
        units: [{ id: 'unit-bag', name: 'Bag', abbreviation: 'bag' }],
        departments: [{ id: 'dep-1', name: 'Housekeeping' }],
        locations: [{ id: 'loc-1', name: 'Main Store', departmentId: 'dep-1' }],
        suppliers: [{ id: 'sup-1', name: 'Best Vendor' }],
    });

    const result = await service.parseImportFile('/tmp/fake.xlsx', 'tenant-1');
    assert.equal(result.preview[0].status, 'ERROR');
    assert.match(result.preview[0].errors.join(' | '), /Vendor 'Missing Vendor' not found/);
});

test('getItems clamps take to 1000', async () => {
    let capturedTake;
    const service = loadServiceForListQueries({
        department: {
            findFirst: async () => ({ id: SAMPLE_DEPT_UUID }),
        },
        item: {
            findMany: async (args) => {
                capturedTake = args.take;
                return [];
            },
            count: async () => 0,
        },
    });

    await service.getItems('tenant-1', { departmentId: SAMPLE_DEPT_UUID, take: '99999' });
    assert.equal(capturedTake, 1000);
});

test('getItems catalog mode omits stockBalances from include', async () => {
    let capturedInclude;
    const service = loadServiceForListQueries({
        department: { findFirst: async () => null },
        item: {
            findMany: async (args) => {
                capturedInclude = args.include;
                return [];
            },
            count: async () => 0,
        },
    });

    await service.getItems('tenant-1', { catalog: 'true' });
    assert.equal(capturedInclude.stockBalances, undefined);
    assert.ok(capturedInclude.itemUnits);
});

test('getItems rejects invalid departmentId', async () => {
    const service = loadServiceForListQueries({
        department: { findFirst: async () => null },
        item: { findMany: async () => [], count: async () => 0 },
    });

    await assert.rejects(
        service.getItems('tenant-1', { departmentId: 'not-a-uuid' }),
        (err) => {
            assert.equal(err.statusCode, 400);
            return true;
        }
    );
});

test('getItems rejects unknown department for tenant', async () => {
    const service = loadServiceForListQueries({
        department: { findFirst: async () => null },
        item: { findMany: async () => [], count: async () => 0 },
    });

    await assert.rejects(
        service.getItems('tenant-1', { departmentId: SAMPLE_DEPT_UUID }),
        (err) => {
            assert.equal(err.statusCode, 404);
            return true;
        }
    );
});

test('getItems adds openingQuantity from stockBalances (no openingUnitCost; use unitPrice)', async () => {
    const service = loadServiceForListQueries({
        item: {
            findMany: async () => [
                {
                    id: 'i1',
                    name: 'Item A',
                    unitPrice: 100,
                    stockBalances: [
                        { qtyOnHand: 10, wacUnitCost: 100, location: { id: 'l1', name: 'Store' } },
                    ],
                },
            ],
            count: async () => 1,
        },
    });

    const result = await service.getItems('tenant-1', { isActive: 'true' });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].openingQuantity, 10);
    assert.equal(result.items[0].unitPrice, 100);
    assert.equal(Object.prototype.hasOwnProperty.call(result.items[0], 'openingUnitCost'), false);
});

test('getItems OB OPEN sets openingQuantity from DRAFT OPENING_BALANCE line sum (not stockBalances)', async () => {
    let groupByWhere;
    const service = loadServiceForListQueries(
        {
            item: {
                findMany: async () => [
                    {
                        id: 'i1',
                        name: 'Item A',
                        unitPrice: 100,
                        stockBalances: [
                            { qtyOnHand: 99, wacUnitCost: 100, location: { id: 'l1', name: 'Store' } },
                        ],
                    },
                ],
                count: async () => 1,
            },
            movementLine: {
                groupBy: async (args) => {
                    groupByWhere = args.where;
                    return [{ itemId: 'i1', _sum: { qtyInBaseUnit: 7 } }];
                },
            },
        },
        { getObStatus: async () => 'OPEN' }
    );

    const result = await service.getItems('tenant-1', { isActive: 'true' });
    assert.equal(result.items[0].openingQuantity, 7);
    assert.equal(result.items[0].displayTotalQty, 7);
    assert.equal(groupByWhere.document.movementType, 'OPENING_BALANCE');
    assert.equal(groupByWhere.document.status, 'DRAFT');
    assert.equal(groupByWhere.document.tenantId, 'tenant-1');
});

test('getItems slim mode uses select, caps take at 5000, skips count and meta path', async () => {
    let findManyArgs;
    let countCalled = false;
    const service = loadServiceForListQueries({
        department: { findFirst: async () => ({ id: SAMPLE_DEPT_UUID }) },
        item: {
            findMany: async (args) => {
                findManyArgs = args;
                return [{ id: 'i1', name: 'A', barcode: 'x' }];
            },
            count: async () => {
                countCalled = true;
                return 0;
            },
        },
    });

    const result = await service.getItems('tenant-1', {
        slim: 'true',
        departmentId: SAMPLE_DEPT_UUID,
        isActive: 'true',
        skip: '10',
        take: '5',
    });

    assert.equal(result.slim, true);
    assert.equal(result.items.length, 1);
    assert.equal(findManyArgs.skip, undefined);
    assert.equal(findManyArgs.take, 5000);
    assert.deepEqual(findManyArgs.select, { id: true, name: true, barcode: true });
    assert.equal(findManyArgs.include, undefined);
    assert.equal(findManyArgs.where.tenantId, 'tenant-1');
    assert.equal(findManyArgs.where.departmentId, SAMPLE_DEPT_UUID);
    assert.equal(findManyArgs.where.isActive, true);
    assert.equal(countCalled, false);
});
