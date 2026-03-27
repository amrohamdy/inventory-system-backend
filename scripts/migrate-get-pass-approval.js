const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function migrate() {
    try {
        console.log('Running Get Pass approval migration...');

        // 1. Add SECURITY to UserRole enum
        await prisma.$executeRawUnsafe(`ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SECURITY'`);
        console.log('✅ Added SECURITY to UserRole');

        // 2. Add new AssetLoanStatus values
        await prisma.$executeRawUnsafe(`ALTER TYPE "AssetLoanStatus" ADD VALUE IF NOT EXISTS 'DRAFT'`);
        await prisma.$executeRawUnsafe(`ALTER TYPE "AssetLoanStatus" ADD VALUE IF NOT EXISTS 'PENDING_SECURITY_EXIT'`);
        await prisma.$executeRawUnsafe(`ALTER TYPE "AssetLoanStatus" ADD VALUE IF NOT EXISTS 'APPROVED_EXIT'`);
        await prisma.$executeRawUnsafe(`ALTER TYPE "AssetLoanStatus" ADD VALUE IF NOT EXISTS 'PENDING_SECURITY_RETURN'`);
        console.log('✅ Added new AssetLoanStatus values');

        // 3. Add approval tracking fields
        const alterCols = [
            `ALTER TABLE "asset_loans" ADD COLUMN IF NOT EXISTS "exitApprovedBy" UUID`,
            `ALTER TABLE "asset_loans" ADD COLUMN IF NOT EXISTS "exitApprovedAt" TIMESTAMP(3)`,
            `ALTER TABLE "asset_loans" ADD COLUMN IF NOT EXISTS "exitNotes" TEXT`,
            `ALTER TABLE "asset_loans" ADD COLUMN IF NOT EXISTS "returnQty" DECIMAL(15,4)`,
            `ALTER TABLE "asset_loans" ADD COLUMN IF NOT EXISTS "returnCondition" TEXT`,
            `ALTER TABLE "asset_loans" ADD COLUMN IF NOT EXISTS "returnNotes" TEXT`,
            `ALTER TABLE "asset_loans" ADD COLUMN IF NOT EXISTS "returnRegisteredBy" UUID`,
            `ALTER TABLE "asset_loans" ADD COLUMN IF NOT EXISTS "returnRegisteredAt" TIMESTAMP(3)`,
            `ALTER TABLE "asset_loans" ADD COLUMN IF NOT EXISTS "returnApprovedBy" UUID`,
            `ALTER TABLE "asset_loans" ADD COLUMN IF NOT EXISTS "returnApprovedAt" TIMESTAMP(3)`,
            `ALTER TABLE "asset_loans" ADD COLUMN IF NOT EXISTS "returnApprovalNotes" TEXT`,
        ];
        for (const sql of alterCols) {
            await prisma.$executeRawUnsafe(sql);
        }
        console.log('✅ Added approval columns to asset_loans');

        // 4. Add FK constraints (ignore if exists)
        const fks = [
            [`asset_loans_exitApprovedBy_fkey`, `"exitApprovedBy"`, `users`],
            [`asset_loans_returnRegisteredBy_fkey`, `"returnRegisteredBy"`, `users`],
            [`asset_loans_returnApprovedBy_fkey`, `"returnApprovedBy"`, `users`],
        ];
        for (const [name, col, ref] of fks) {
            await prisma.$executeRawUnsafe(`
                DO $$ BEGIN
                  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = '${name}') THEN
                    ALTER TABLE "asset_loans" ADD CONSTRAINT "${name}" FOREIGN KEY (${col}) REFERENCES "${ref}"("id") ON DELETE SET NULL ON UPDATE CASCADE;
                  END IF;
                END $$
            `);
        }
        console.log('✅ Added FK constraints');

        console.log('\n🎉 Migration completed successfully!');
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

migrate();
