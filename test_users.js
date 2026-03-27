const { listUsers } = require('./src/services/users.service');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        const tenantId = "9bc9f9fd-b890-4914-a5ec-d033157e1362"; // Using the tenantId from previous tests
        const res = await listUsers(tenantId, { page: 1, limit: 20 });
        console.log("Success:", res.users.length);
    } catch (error) {
        console.error("Error fetching users:");
        console.error(error);
    }
}

main().finally(() => prisma.$disconnect());
