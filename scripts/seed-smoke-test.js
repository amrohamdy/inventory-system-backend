/* eslint-disable no-console */
'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const IDS = {
    tenant: '11111111-1111-1111-1111-111111111111',
    user: '22222222-2222-2222-2222-222222222222',
    department: '33333333-3333-3333-3333-333333333333',
    category: '44444444-4444-4444-4444-444444444444',
    unit: '55555555-5555-5555-5555-555555555555',
    sourceLocation: '66666666-6666-6666-6666-666666666666',
    destLocation: '77777777-7777-7777-7777-777777777777',
    item: '88888888-8888-8888-8888-888888888888',
    breakageDoc: '99999999-9999-9999-9999-999999999999',
    breakageLine: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    transfer: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    transferLine: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
};

const now = new Date();

async function seedCoreMasterData() {
    await prisma.tenant.upsert({
        where: { id: IDS.tenant },
        update: { name: 'Smoke Test Tenant', slug: 'smoke-test-tenant', isActive: true },
        create: { id: IDS.tenant, name: 'Smoke Test Tenant', slug: 'smoke-test-tenant' },
    });

    await prisma.user.upsert({
        where: { id: IDS.user },
        update: {
            email: 'smoke.tester@example.com',
            firstName: 'Smoke',
            lastName: 'Tester',
            isActive: true,
        },
        create: {
            id: IDS.user,
            email: 'smoke.tester@example.com',
            passwordHash: 'smoke-hash',
            firstName: 'Smoke',
            lastName: 'Tester',
        },
    });

    await prisma.department.upsert({
        where: { id: IDS.department },
        update: { tenantId: IDS.tenant, name: 'Smoke Dept', code: 'SMK' },
        create: { id: IDS.department, tenantId: IDS.tenant, name: 'Smoke Dept', code: 'SMK' },
    });

    await prisma.category.upsert({
        where: { id: IDS.category },
        update: { tenantId: IDS.tenant, name: 'Smoke Category', departmentId: IDS.department },
        create: {
            id: IDS.category,
            tenantId: IDS.tenant,
            name: 'Smoke Category',
            departmentId: IDS.department,
        },
    });

    await prisma.unit.upsert({
        where: { id: IDS.unit },
        update: { tenantId: IDS.tenant, name: 'Piece', abbreviation: 'pc' },
        create: { id: IDS.unit, tenantId: IDS.tenant, name: 'Piece', abbreviation: 'pc' },
    });

    await prisma.location.upsert({
        where: { id: IDS.sourceLocation },
        update: { tenantId: IDS.tenant, name: 'Smoke Source Store', departmentId: IDS.department },
        create: {
            id: IDS.sourceLocation,
            tenantId: IDS.tenant,
            name: 'Smoke Source Store',
            departmentId: IDS.department,
        },
    });

    await prisma.location.upsert({
        where: { id: IDS.destLocation },
        update: { tenantId: IDS.tenant, name: 'Smoke Destination Store', departmentId: IDS.department },
        create: {
            id: IDS.destLocation,
            tenantId: IDS.tenant,
            name: 'Smoke Destination Store',
            departmentId: IDS.department,
        },
    });

    await prisma.item.upsert({
        where: { id: IDS.item },
        update: {
            tenantId: IDS.tenant,
            name: 'Smoke Test Item',
            barcode: 'SMOKE-ITEM-001',
            categoryId: IDS.category,
            departmentId: IDS.department,
            defaultStoreId: IDS.sourceLocation,
            unitPrice: 25,
        },
        create: {
            id: IDS.item,
            tenantId: IDS.tenant,
            name: 'Smoke Test Item',
            barcode: 'SMOKE-ITEM-001',
            categoryId: IDS.category,
            departmentId: IDS.department,
            defaultStoreId: IDS.sourceLocation,
            unitPrice: 25,
        },
    });
}

async function seedApprovedBreakage() {
    await prisma.movementDocument.upsert({
        where: { id: IDS.breakageDoc },
        update: {
            tenantId: IDS.tenant,
            documentNo: 'BRK-SMOKE-0001',
            movementType: 'BREAKAGE',
            sourceType: 'INTERNAL',
            status: 'APPROVED',
            sourceLocationId: IDS.sourceLocation,
            documentDate: now,
            postedAt: now,
            reason: 'Smoke test breakage',
            suggestedAction: 'HOTEL',
            responsibleEmployeeName: 'Smoke Employee',
            photoKey: 'tenants/smoke/breakages/smoke-photo.jpg',
            createdBy: IDS.user,
        },
        create: {
            id: IDS.breakageDoc,
            tenantId: IDS.tenant,
            documentNo: 'BRK-SMOKE-0001',
            movementType: 'BREAKAGE',
            sourceType: 'INTERNAL',
            status: 'APPROVED',
            sourceLocationId: IDS.sourceLocation,
            documentDate: now,
            postedAt: now,
            reason: 'Smoke test breakage',
            suggestedAction: 'HOTEL',
            responsibleEmployeeName: 'Smoke Employee',
            photoKey: 'tenants/smoke/breakages/smoke-photo.jpg',
            createdBy: IDS.user,
        },
    });

    await prisma.movementLine.deleteMany({ where: { documentId: IDS.breakageDoc } });
    await prisma.movementLine.create({
        data: {
            id: IDS.breakageLine,
            documentId: IDS.breakageDoc,
            itemId: IDS.item,
            locationId: IDS.sourceLocation,
            unitId: IDS.unit,
            qtyRequested: 2,
            qtyInBaseUnit: 2,
            unitCost: 25,
            totalValue: 50,
            notes: 'Smoke test line',
        },
    });
}

async function seedReceivedTransfer() {
    await prisma.storeTransfer.upsert({
        where: { id: IDS.transfer },
        update: {
            tenantId: IDS.tenant,
            transferNo: 'TRF-SMOKE-0001',
            sourceLocationId: IDS.sourceLocation,
            destLocationId: IDS.destLocation,
            requestedBy: IDS.user,
            status: 'RECEIVED',
            transferDate: now,
            receivedAt: now,
            closedAt: now,
            notes: 'Smoke transfer',
        },
        create: {
            id: IDS.transfer,
            tenantId: IDS.tenant,
            transferNo: 'TRF-SMOKE-0001',
            sourceLocationId: IDS.sourceLocation,
            destLocationId: IDS.destLocation,
            requestedBy: IDS.user,
            status: 'RECEIVED',
            transferDate: now,
            receivedAt: now,
            closedAt: now,
            notes: 'Smoke transfer',
        },
    });

    await prisma.storeTransferLine.deleteMany({ where: { transferId: IDS.transfer } });
    await prisma.storeTransferLine.create({
        data: {
            id: IDS.transferLine,
            transferId: IDS.transfer,
            itemId: IDS.item,
            uomId: IDS.unit,
            requestedQty: 3,
            receivedQty: 3,
            unitCost: 25,
            totalValue: 75,
            notes: 'Smoke transfer line',
        },
    });
}

async function main() {
    await seedCoreMasterData();
    await seedApprovedBreakage();
    await seedReceivedTransfer();

    console.log('Smoke seed completed.');
    console.log(
        JSON.stringify(
            {
                tenantId: IDS.tenant,
                breakageDocumentId: IDS.breakageDoc,
                transferId: IDS.transfer,
            },
            null,
            2
        )
    );
}

main()
    .catch((err) => {
        console.error('Smoke seed failed:', err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
