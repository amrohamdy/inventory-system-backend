const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const UNITS = [
    ['Piece', 'pcs'],
    ['Unit', 'unit'],
    ['Dozen', 'dz'],
    ['Set', 'set'],
    ['Pair', 'pair'],
    ['Kilogram', 'kg'],
    ['Gram', 'g'],
    ['Liter', 'ltr'],
    ['Milliliter', 'ml'],
    ['Bottle', 'btl'],
    ['Can', 'can'],
    ['Carton', 'ctn'],
    ['Box', 'box'],
    ['Pack', 'pk'],
    ['Tray', 'try'],
    ['Bag', 'bag'],
    ['Gallon', 'gal'],
    ['Roll', 'roll'],
    ['Bucket', 'bkt'],
    ['Jerrycan', 'jcn'],
    ['Meter', 'm'],
    ['Square Meter', 'm2'],
    ['Sheet', 'sht'],
    ['Box 100pcs', 'bx100'],
    ['Person/Pax', 'pax'],
];

async function main() {
    const tenants = await prisma.tenant.findMany({
        select: { id: true, name: true, slug: true },
    });

    if (tenants.length === 0) {
        console.log('No tenants found. Nothing to seed.');
        return;
    }

    console.log(`Found ${tenants.length} tenant(s). Seeding ${UNITS.length} unit(s) each...`);

    for (const tenant of tenants) {
        let createdOrUpdated = 0;

        for (const [name, abbreviation] of UNITS) {
            await prisma.unit.upsert({
                where: {
                    tenantId_name: {
                        tenantId: tenant.id,
                        name,
                    },
                },
                update: {
                    abbreviation,
                    isActive: true,
                },
                create: {
                    tenantId: tenant.id,
                    name,
                    abbreviation,
                    isActive: true,
                },
            });
            createdOrUpdated += 1;
        }

        console.log(
            `Tenant: ${tenant.name} (${tenant.slug}) -> processed ${createdOrUpdated} unit(s)`
        );
    }

    console.log('Done seeding units for all tenants.');
}

main()
    .catch((error) => {
        console.error('Seed failed:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
