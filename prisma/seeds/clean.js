/**
 * clean.js — Wipes ALL data from all tables, keeping schema intact.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('🧹 Cleaning ALL data...\n');

    // Disable FK checks, truncate everything, re-enable
    await prisma.$executeRawUnsafe(`
        DO $$ DECLARE
            r RECORD;
        BEGIN
            FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
                EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
            END LOOP;
        END $$;
    `);

    console.log('✅ All tables cleared!');
    console.log('📌 Schema intact — system is completely empty.');
    console.log('\n💡 The system is now fresh. You can create a new tenant from /admin or via the seed script.');
}

main()
    .catch((e) => { console.error('❌ Clean failed:', e.message); process.exit(1); })
    .finally(() => prisma.$disconnect());
