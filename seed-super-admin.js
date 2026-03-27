/**
 * SaaS Phase 1 — Seed Platform Tenant + SUPER_ADMIN user
 *
 * Creates a SUPER_ADMIN user (global membership with null tenant).
 * Usage: node seed-super-admin.js
 */
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('./src/utils/password');
const prisma = new PrismaClient();

async function main() {
    console.log('── Seeding Platform Tenant + SUPER_ADMIN ──');

    // 1. Create or find platform tenant
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
        console.log(`  ✅ Platform tenant created: ${platform.id}`);
    } else {
        console.log(`  ℹ  Platform tenant already exists: ${platform.id}`);
    }

    // 2. Create subscription for platform (ENTERPRISE, no limits)
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

    // 3. Create usage tracker
    await prisma.tenantUsage.upsert({
        where: { tenantId: platform.id },
        create: { tenantId: platform.id, totalUsers: 1 },
        update: {},
    });

    // 4. Create SUPER_ADMIN user
    const email = 'superadmin@ose.cloud';
    const password = 'SuperAdmin@2026';
    const existing = await prisma.user.findUnique({ where: { email } });

    if (!existing) {
        const pwHash = await hashPassword(password);
        const user = await prisma.user.create({
            data: {
                email,
                passwordHash: pwHash,
                firstName: 'Super',
                lastName: 'Admin',
            },
        });
        await prisma.tenantMember.create({
            data: {
                tenantId: null,
                userId: user.id,
                role: 'SUPER_ADMIN',
                isActive: true,
            },
        });
        console.log(`  ✅ SUPER_ADMIN user created: ${email} / ${password}`);
    } else {
        await prisma.tenantMember.upsert({
            where: { tenantId_userId: { tenantId: null, userId: existing.id } },
            create: {
                tenantId: null,
                userId: existing.id,
                role: 'SUPER_ADMIN',
                isActive: true,
            },
            update: {
                role: 'SUPER_ADMIN',
                isActive: true,
            },
        });
        console.log(`  ℹ  SUPER_ADMIN user already exists: ${email}`);
    }

    console.log('\n── Done. You can now login as SUPER_ADMIN at /api/auth/login ──');
    console.log(`   email: ${email}`);
    console.log(`   password: ${password}`);
    console.log('   tenantSlug: (not required for super admin)');
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
