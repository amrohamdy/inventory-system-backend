/**
 * SaaS Phase 1 — Seed Platform Tenant + SUPER_ADMIN user
 *
 * Creates a SUPER_ADMIN user (global membership with null tenant).
 * Updated: Uses upsert for Roles and TenantMembers to prevent P2025/P3005 errors.
 * Usage: node seed-super-admin.js
 */
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('./src/utils/password');
const prisma = new PrismaClient();

async function main() {
    console.log('── Seeding Platform Tenant + SUPER_ADMIN ──');

    // 1. Create or find the SUPER_ADMIN Role (Crucial for Railway)
    const superAdminRole = await prisma.role.upsert({
        where: { code: 'SUPER_ADMIN' },
        update: {},
        create: {
            code: 'SUPER_ADMIN',
            name: 'Super Administrator',
            description: 'Full system access with global scope',
        },
    });
    console.log(`  ✅ Role SUPER_ADMIN verified: ${superAdminRole.id}`);

    // 2. Create or find platform tenant
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

    // 3. Create subscription for platform (ENTERPRISE, no limits)
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

    // 4. Create usage tracker
    await prisma.tenantUsage.upsert({
        where: { tenantId: platform.id },
        create: { tenantId: platform.id, totalUsers: 1 },
        update: {},
    });

    // 5. Create/Update SUPER_ADMIN user
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
    console.log(`  ✅ User SUPER_ADMIN verified: ${user.email}`);

    // 6. Create/Update Global Membership (TenantMember)
    // We look for a membership where tenantId is null and role is SUPER_ADMIN
    const existingMembership = await prisma.tenantMember.findFirst({
        where: { 
            userId: user.id, 
            tenantId: null 
        }
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

    console.log('\n── Done. You can now login as SUPER_ADMIN at /api/auth/login ──');
    console.log(`   email: ${email}`);
    console.log(`   password: ${password}`);
    console.log('   tenantSlug: (not required for super admin)');
}

main()
    .catch(e => { 
        console.error('❌ Error during seeding:', e); 
        process.exit(1); 
    })
    .finally(() => prisma.$disconnect());