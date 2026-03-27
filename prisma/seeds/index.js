const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding OS&E Inventory System...');

    // ─── Create Demo Tenant ─────────────────────────────────────────────────
    const tenant = await prisma.tenant.upsert({
        where: { slug: 'grand-horizon' },
        update: {},
        create: {
            name: 'Grand Horizon Hotel',
            slug: 'grand-horizon',
            subscriptionTier: 'enterprise',
            email: 'admin@grandhorizon.com',
            phone: '+971-4-555-0100',
            address: 'Sheikh Zayed Road, Dubai, UAE',
        },
    });
    console.log(`✅ Tenant: ${tenant.name} (${tenant.slug})`);

    // ─── Create Users (one per role) ─────────────────────────────────────────
    const passwordHash = await bcrypt.hash('Admin@123', 12);

    const users = [
        { email: 'admin@grandhorizon.com', firstName: 'Sarah', lastName: 'Ahmed', role: 'ADMIN' },
        { email: 'store@grandhorizon.com', firstName: 'Khalid', lastName: 'Hassan', role: 'STOREKEEPER' },
        { email: 'fb.manager@grandhorizon.com', firstName: 'Layla', lastName: 'Mansour', role: 'DEPT_MANAGER', department: 'F&B' },
        { email: 'hk.manager@grandhorizon.com', firstName: 'Omar', lastName: 'Al-Said', role: 'DEPT_MANAGER', department: 'Housekeeping' },
        { email: 'cost@grandhorizon.com', firstName: 'Nadia', lastName: 'Ibrahim', role: 'COST_CONTROL' },
        { email: 'finance@grandhorizon.com', firstName: 'Youssef', lastName: 'Karimi', role: 'FINANCE_MANAGER' },
        { email: 'auditor@grandhorizon.com', firstName: 'Hana', lastName: 'Al-Rashid', role: 'AUDITOR' },
    ];

    for (const userData of users) {
        const { role, ...profileData } = userData;
        const user = await prisma.user.upsert({
            where: { email: userData.email },
            update: {
                firstName: profileData.firstName,
                lastName: profileData.lastName,
                department: profileData.department || null,
                isActive: true,
            },
            create: { passwordHash, ...profileData },
        });
        await prisma.tenantMember.upsert({
            where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
            update: { role, isActive: true },
            create: { tenantId: tenant.id, userId: user.id, role, isActive: true },
        });
        console.log(`  👤 ${role}: ${user.firstName} ${user.lastName} (${user.email})`);
    }

    // ─── Create Departments ─────────────────────────────────────────────────
    const deptData = [
        { name: 'Housekeeping', code: 'HK' },
        { name: 'Food & Beverage', code: 'FB' },
        { name: 'Engineering', code: 'ENG' },
        { name: 'Spa & Wellness', code: 'SPA' },
        { name: 'General', code: 'GEN' },
    ];

    const deptMap = {};
    for (const d of deptData) {
        const dept = await prisma.department.upsert({
            where: { tenantId_name: { tenantId: tenant.id, name: d.name } },
            update: {},
            create: { tenantId: tenant.id, name: d.name, code: d.code },
        });
        deptMap[d.name] = dept.id;
        console.log(`  🏢 Department: ${d.name} (${d.code})`);
    }

    // ─── Create Locations ──────────────────────────────────────────────────
    const locations = [
        { name: 'Main Store', type: 'MAIN_STORE', description: 'Central receiving and storage', dept: 'General' },
        { name: 'F&B Store', type: 'OUTLET_STORE', description: 'Food & Beverage outlet store', dept: 'Food & Beverage' },
        { name: 'Housekeeping Store', type: 'OUTLET_STORE', description: 'Housekeeping linen & amenities store', dept: 'Housekeeping' },
        { name: 'Spa Store', type: 'OUTLET_STORE', description: 'Spa & wellness products store', dept: 'Spa & Wellness' },
        { name: 'Engineering Store', type: 'DEPARTMENT', description: 'Engineering materials and tools', dept: 'Engineering' },
    ];

    for (const loc of locations) {
        await prisma.location.upsert({
            where: { tenantId_name: { tenantId: tenant.id, name: loc.name } },
            update: { departmentId: deptMap[loc.dept] },
            create: { tenantId: tenant.id, name: loc.name, type: loc.type, description: loc.description, departmentId: deptMap[loc.dept] },
        });
        console.log(`  📦 Location: ${loc.name} → ${loc.dept}`);
    }

    // ─── Create Units ─────────────────────────────────────────────────────
    const units = [
        { name: 'Piece', abbreviation: 'PCS' },
        { name: 'Carton', abbreviation: 'CTN' },
        { name: 'Box', abbreviation: 'BOX' },
        { name: 'Kilogram', abbreviation: 'KG' },
        { name: 'Liter', abbreviation: 'LTR' },
        { name: 'Dozen', abbreviation: 'DZN' },
        { name: 'Roll', abbreviation: 'ROL' },
        { name: 'Set', abbreviation: 'SET' },
        { name: 'Pack', abbreviation: 'PCK' },
        { name: 'Bottle', abbreviation: 'BTL' },
    ];

    for (const unit of units) {
        await prisma.unit.upsert({
            where: { tenantId_name: { tenantId: tenant.id, name: unit.name } },
            update: {},
            create: { tenantId: tenant.id, ...unit },
        });
    }
    console.log(`  📐 ${units.length} units of measure created`);

    // ─── Create Categories ────────────────────────────────────────────────
    const categories = [
        { name: 'Linen & Bedding', subcategories: ['Bed Sheets', 'Pillowcases', 'Towels', 'Bath Robes'] },
        { name: 'Guest Amenities', subcategories: ['Toiletries', 'Room Accessories', 'Minibar'] },
        { name: 'Cleaning Supplies', subcategories: ['Chemicals', 'Cleaning Tools', 'Waste Bags'] },
        { name: 'F&B Supplies', subcategories: ['Tableware', 'Glassware', 'Kitchen Tools', 'Cutlery'] },
        { name: 'Engineering', subcategories: ['Electrical', 'Plumbing', 'HVAC', 'General Maintenance'] },
        { name: 'Office Supplies', subcategories: ['Stationery', 'Printing', 'IT Accessories'] },
    ];

    for (const cat of categories) {
        const category = await prisma.category.upsert({
            where: { tenantId_name: { tenantId: tenant.id, name: cat.name } },
            update: {},
            create: { tenantId: tenant.id, name: cat.name },
        });

        for (const subName of cat.subcategories) {
            await prisma.subcategory.upsert({
                where: { tenantId_categoryId_name: { tenantId: tenant.id, categoryId: category.id, name: subName } },
                update: {},
                create: { tenantId: tenant.id, categoryId: category.id, name: subName },
            });
        }
        console.log(`  🏷️  Category: ${cat.name} (${cat.subcategories.length} subcategories)`);
    }

    // ─── Create Suppliers ─────────────────────────────────────────────────
    const suppliers = [
        { name: 'Emirates Linen Co.', contactPerson: 'Ahmad Khalid', email: 'sales@emirateslinen.ae' },
        { name: 'Gulf Cleaning Supplies', contactPerson: 'Fatima Al-Ali', email: 'orders@gulfcleaning.ae' },
        { name: 'Hotel Amenities MENA', contactPerson: 'Carlos Rivera', email: 'info@hamenities.com' },
    ];

    for (const sup of suppliers) {
        await prisma.supplier.upsert({
            where: { tenantId_name: { tenantId: tenant.id, name: sup.name } },
            update: {},
            create: { tenantId: tenant.id, ...sup },
        });
        console.log(`  🏭 Supplier: ${sup.name}`);
    }

    // ─── Create Demo Items ──────────────────────────────────────────────────
    // Get first category and supplier for linking
    const firstCategory = await prisma.category.findFirst({ where: { tenantId: tenant.id } });
    const firstSupplier = await prisma.supplier.findFirst({ where: { tenantId: tenant.id } });
    const firstUnit = await prisma.unit.findFirst({ where: { tenantId: tenant.id, abbreviation: 'PCS' } });

    const items = [
        { name: 'Bath Towel - White', barcode: 'OSE-001', unitPrice: 25.00 },
        { name: 'Hand Towel - White', barcode: 'OSE-002', unitPrice: 12.50 },
        { name: 'King Bed Sheet Set', barcode: 'OSE-003', unitPrice: 85.00 },
        { name: 'Shampoo 30ml', barcode: 'OSE-004', unitPrice: 2.00 },
        { name: 'Soap Bar 40g', barcode: 'OSE-005', unitPrice: 1.50 },
        { name: 'Shower Cap', barcode: 'OSE-006', unitPrice: 0.75 },
        { name: 'All-Purpose Cleaner 5L', barcode: 'OSE-007', unitPrice: 45.00 },
        { name: 'Garbage Bag Roll (50pcs)', barcode: 'OSE-008', unitPrice: 18.00 },
        { name: 'Dinner Plate - Porcelain', barcode: 'OSE-009', unitPrice: 22.00 },
        { name: 'Wine Glass - Crystal', barcode: 'OSE-010', unitPrice: 35.00 },
    ];

    const firstLocation = await prisma.location.findFirst({ where: { tenantId: tenant.id } });
    const firstDept = await prisma.department.findFirst({ where: { tenantId: tenant.id } });

    for (const itemData of items) {
        await prisma.item.upsert({
            where: { tenantId_name: { tenantId: tenant.id, name: itemData.name } },
            update: { departmentId: firstDept?.id, defaultStoreId: firstLocation?.id },
            create: {
                tenantId: tenant.id,
                ...itemData,
                categoryId: firstCategory?.id,
                supplierId: firstSupplier?.id,
                departmentId: firstDept?.id,
                defaultStoreId: firstLocation?.id,
            },
        });
    }
    console.log(`  📦 ${items.length} demo items created`);

    console.log('\n✅ Seed complete!');
    console.log('\n📋 Demo Credentials (tenant slug: grand-horizon):');
    console.log('   All users password: Admin@123');
    users.forEach((u) => console.log(`   ${u.role.padEnd(20)} → ${u.email}`));
}

main()
    .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
