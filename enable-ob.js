/**
 * Enable Opening Balance for all tenants (one-time setup script)
 * Run: node enable-ob.js
 */
require('dotenv').config();
const prisma = require('./src/config/database');

async function main() {
    // Find all tenants
    const tenants = await prisma.tenant.findMany({ select: { id: true, name: true, slug: true } });
    console.log(`Found ${tenants.length} tenant(s)\n`);

    for (const tenant of tenants) {
        // Check current status
        const current = await prisma.tenantSetting.findUnique({
            where: { tenantId_key: { tenantId: tenant.id, key: 'allowOpeningBalance' } },
        });

        const postedNonOB = await prisma.movementDocument.count({
            where: { tenantId: tenant.id, status: 'POSTED', movementType: { notIn: ['OPENING_BALANCE'] } },
        });

        // Find an admin user to use as updatedBy
        const admin = await prisma.user.findFirst({
            where: { tenantId: tenant.id, role: { in: ['SUPER_ADMIN', 'ADMIN'] } },
            select: { id: true, email: true },
        });

        if (!admin) {
            console.log(`[${tenant.slug}] ⚠️  No admin user found — skipping`);
            continue;
        }

        console.log(`[${tenant.slug}] Current setting: ${current?.value || 'NOT SET'} | Non-OB posted movements: ${postedNonOB}`);

        // Force OPEN regardless of movements (admin override)
        await prisma.tenantSetting.upsert({
            where: { tenantId_key: { tenantId: tenant.id, key: 'allowOpeningBalance' } },
            update: {
                value: 'OPEN',
                updatedBy: admin.id,
                reason: 'Admin override: enabled for initial stock data entry',
            },
            create: {
                tenantId: tenant.id,
                key: 'allowOpeningBalance',
                value: 'OPEN',
                updatedBy: admin.id,
                reason: 'Admin override: enabled for initial stock data entry',
            },
        });

        console.log(`[${tenant.slug}] ✅ OB enabled (updatedBy: ${admin.email})\n`);
    }

    console.log('Done. You can now use Import as Opening Balance in Item Master.');
    await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
