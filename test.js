const { processApproval } = require('./src/services/stockReport.service');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const id = "6d75a522-1675-49f6-aaca-725bf59f3d43";
    const tenantId = "9bc9f9fd-b890-4914-a5ec-d033157e1362";
    const userId = "5d08fa92-5d82-42a6-a497-53c33b21e595";

    try {
        const res = await processApproval(id, tenantId, userId, 'APPROVE');
        console.log("Success:", res);
    } catch (err) {
        console.error("Error occurred:");
        console.error(err);
    }
}

main().finally(() => prisma.$disconnect());
