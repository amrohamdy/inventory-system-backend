/**
 * System initializer — global Role rows + platform tenant + SUPER_ADMIN user.
 *
 * Ensures `connectRole(...)` and tenant/org flows find every role code the API uses.
 * Roles are tenant-agnostic (`tenantId: null`).
 *
 * Usage: node seed-super-admin.js
 */
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('./src/utils/password');

const prisma = new PrismaClient();

/** Must stay in sync with src/utils/validators.js + middleware/authorize.js usage. */
const SYSTEM_ROLES = [
    { code: 'SUPER_ADMIN', name: 'Super Administrator' },
    { code: 'ORG_MANAGER', name: 'Organization Manager' },
    { code: 'ADMIN', name: 'Administrator' },
    { code: 'STOREKEEPER', name: 'Storekeeper' },
    { code: 'DEPT_MANAGER', name: 'Department Manager' },
    { code: 'COST_CONTROL', name: 'Cost Control' },
    { code: 'FINANCE_MANAGER', name: 'Finance Manager' },
    { code: 'AUDITOR', name: 'Auditor' },
    { code: 'SECURITY', name: 'Security' },
];

async function seedSystemRoles() {
    console.log('── Seeding system roles (global) ──');
    for (const { code, name } of SYSTEM_ROLES) {
        await prisma.role.upsert({
            where: { code },
            update: { name, isActive: true },
            create: { code, name, tenantId: null, isActive: true },
        });
        console.log(`  ✅ Role ${code}`);
    }
}

async function main() {
    console.log('── System initializer (roles + platform + SUPER_ADMIN) ──\n');

    await seedSystemRoles();

    const superAdminRole = await prisma.role.findUnique({
        where: { code: 'SUPER_ADMIN' },
        select: { id: true },
    });
    if (!superAdminRole) {
        throw new Error('SUPER_ADMIN role missing after seedSystemRoles()');
    }

    let platform = await prisma.tenant.findUnique({ where: { slug: 'platform' } });
    if (!platform) {
        platform = await prisma.tenant.create({
            data: {
                name: 'OS&E Platform',
                slug: 'platform',
                subscriptionTier: 'ENTERPRISE',
                isActive: true,
            },
        });
        console.log(`\n  ✅ Platform tenant created: ${platform.id}`);
    } else {
        console.log(`\n  ℹ  Platform tenant already exists: ${platform.id}`);
    }

    await prisma.subscription.upsert({
        where: { tenantId: platform.id },
        create: {
            tenantId: platform.id,
            planType: 'ENTERPRISE',
            status: 'ACTIVE',
            maxUsers: 99999,
            maxStores: 99999,
            maxDepartments: 99999,
            maxMonthlyMovements: 999999,
        },
        update: { status: 'ACTIVE' },
    });
    console.log('  ✅ Platform subscription (ENTERPRISE) set');

    await prisma.tenantUsage.upsert({
        where: { tenantId: platform.id },
        create: { tenantId: platform.id, totalUsers: 1 },
        update: {},
    });

    const email = 'superadmin@ose.cloud';
    const password = 'superadmin@2026';
    const pwHash = await hashPassword(password);

    const user = await prisma.user.upsert({
        where: { email },
        update: {
            passwordHash: pwHash,
            isActive: true,
        },
        create: {
            email,
            passwordHash: pwHash,
            firstName: 'Super',
            lastName: 'Admin',
            isActive: true,
        },
    });
    console.log(`  ✅ User SUPER_ADMIN: ${user.email}`);

    const existingMembership = await prisma.tenantMember.findFirst({
        where: { userId: user.id, tenantId: null },
    });

    if (existingMembership) {
        await prisma.tenantMember.update({
            where: { id: existingMembership.id },
            data: {
                roleId: superAdminRole.id,
                isActive: true,
            },
        });
        console.log('  ✅ Global membership updated');
    } else {
        await prisma.tenantMember.create({
            data: {
                userId: user.id,
                roleId: superAdminRole.id,
                tenantId: null,
                isActive: true,
            },
        });
        console.log('  ✅ Global membership created');
    }

    console.log('\n── Done. Login as SUPER_ADMIN at /api/auth/login ──');
    console.log(`   email: ${email}`);
    console.log(`   password: ${password}`);
    console.log('   tenantSlug: (optional for super admin)');
}

main()
    .catch((e) => {
        console.error('❌ Error during seeding:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
