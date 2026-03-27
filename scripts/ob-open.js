const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function openOB() {
    const tenant = await p.tenant.findFirst({ where: { slug: 'grand-horizon' } });
    if (!tenant) { console.error('Tenant not found'); return; }

    await p.tenantSetting.upsert({
        where: { tenantId_key: { tenantId: tenant.id, key: 'allowOpeningBalance' } },
        update: { value: 'OPEN', reason: 'Temporarily opened for testing by Super Admin' },
        create: { tenantId: tenant.id, key: 'allowOpeningBalance', value: 'OPEN', reason: 'Temporarily opened for testing by Super Admin' },
    });

    console.log(`✅ OB is now OPEN for tenant: ${tenant.name} (${tenant.slug})`);
    await p.$disconnect();
}

openOB().catch(e => { console.error(e); p.$disconnect(); });
