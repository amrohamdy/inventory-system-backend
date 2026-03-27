const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
async function main() {
    const tenant = await p.tenant.findFirst();
    await p.tenantSetting.upsert({
        where: { tenantId_key: { tenantId: tenant.id, key: 'ob_import_enabled' } },
        update: { value: 'false' },
        create: { tenantId: tenant.id, key: 'ob_import_enabled', value: 'false' }
    });
    console.log('✅ Opening Balance LOCKED for tenant:', tenant.name);
    await p.$disconnect();
}
main().catch(console.error);
