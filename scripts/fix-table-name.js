const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // Rename location_category -> location_categories (Prisma @@map name)
    await prisma.$executeRawUnsafe(`
        ALTER TABLE IF EXISTS "location_category" RENAME TO "location_categories"
    `);
    console.log('✅ Renamed location_category -> location_categories');

    // Also rename the constraints/indexes accordingly
    await prisma.$executeRawUnsafe(`ALTER INDEX IF EXISTS "location_category_pkey" RENAME TO "location_categories_pkey"`);
    await prisma.$executeRawUnsafe(`ALTER INDEX IF EXISTS "location_category_locationId_categoryId_key" RENAME TO "location_categories_locationId_categoryId_key"`);
    await prisma.$executeRawUnsafe(`ALTER INDEX IF EXISTS "location_category_locationId_idx" RENAME TO "location_categories_locationId_idx"`);
    await prisma.$executeRawUnsafe(`ALTER INDEX IF EXISTS "location_category_categoryId_idx" RENAME TO "location_categories_categoryId_idx"`);
    console.log('✅ Renamed indexes');

    // Also add createdAt column if needed (schema has no createdAt but check)
    // Verify table exists
    const result = await prisma.$queryRawUnsafe(`SELECT COUNT(*) FROM "location_categories"`);
    console.log('✅ Table accessible:', result);
}

main().then(() => prisma.$disconnect()).catch(e => { console.error('❌', e.message); prisma.$disconnect(); process.exit(1); });
