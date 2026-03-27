const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // Test the same query that location.service.js runs
    const locations = await prisma.location.findMany({
        take: 10,
        orderBy: { name: 'asc' },
        include: {
            department: { select: { id: true, name: true, code: true } },
            locationCategories: {
                include: { category: { select: { id: true, name: true } } }
            },
            _count: { select: { locationUsers: true, defaultItems: true } }
        }
    });
    console.log(`✅ Found ${locations.length} locations`);
    locations.forEach(l => console.log(`  - ${l.name} | cats: ${l.locationCategories?.length}`));
}

main().then(() => prisma.$disconnect()).catch(e => { console.error('❌', e.message); prisma.$disconnect(); process.exit(1); });
