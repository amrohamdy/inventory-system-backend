const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const locations = await prisma.location.findMany({ take: 20 });
    console.log(`\n📍 Locations (${locations.length} found):`);
    locations.forEach(l => console.log(`  - ${l.name} [${l.type}]`));

    const categories = await prisma.category.findMany({ take: 20 });
    console.log(`\n🗂️  Categories (${categories.length} found):`);
    categories.forEach(c => console.log(`  - ${c.name} | deptId: ${c.departmentId || 'none'}`));

    const tenants = await prisma.tenant.findMany({ select: { id: true, name: true, slug: true } });
    console.log(`\n🏢 Tenants: ${tenants.map(t => t.slug).join(', ')}`);
}

main().then(() => prisma.$disconnect()).catch(e => { console.error(e.message); prisma.$disconnect(); });
