const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
async function main() {
    // Check actual table names
    const tables = await p.$queryRaw`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
    `;
    tables.forEach(t => console.log(t.tablename));
    await p.$disconnect();
}
main().catch(console.error);
