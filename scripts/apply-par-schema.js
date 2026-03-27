const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('Applying schema changes...');
    
    await prisma.$executeRawUnsafe(`
        ALTER TABLE categories ADD COLUMN IF NOT EXISTS "departmentId" UUID REFERENCES departments(id) ON DELETE SET NULL
    `);
    console.log('✅ Added departmentId to categories');

    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "location_category" (
            "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
            "locationId" UUID NOT NULL,
            "categoryId" UUID NOT NULL,
            "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "location_category_pkey" PRIMARY KEY ("id"),
            CONSTRAINT "location_category_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT "location_category_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT "location_category_locationId_categoryId_key" UNIQUE ("locationId", "categoryId")
        )
    `);
    console.log('✅ Created location_category table');

    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "categories_departmentId_idx" ON "categories"("departmentId")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "location_category_locationId_idx" ON "location_category"("locationId")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "location_category_categoryId_idx" ON "location_category"("categoryId")`);
    console.log('✅ Created indexes');
    console.log('✅ All done!');
}

main().then(() => prisma.$disconnect()).catch(e => { console.error('❌', e.message); prisma.$disconnect(); process.exit(1); });
