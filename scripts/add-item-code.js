const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
async function main() {
    // Add code column to items table if not exists
    await p.$executeRawUnsafe(`
        ALTER TABLE items ADD COLUMN IF NOT EXISTS code VARCHAR(100);
    `);
    // Add unique constraint per tenant (skip if already exists)
    await p.$executeRawUnsafe(`
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'items_tenant_code_unique'
            ) THEN
                ALTER TABLE items ADD CONSTRAINT items_tenant_code_unique UNIQUE ("tenantId", code);
            END IF;
        END $$;
    `);
    console.log('✅ Added code field to Item table');
    await p.$disconnect();
}
main().catch(console.error);
