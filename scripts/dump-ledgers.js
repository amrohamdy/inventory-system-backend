const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        const ledgers = await prisma.inventoryLedger.findMany({
            where: { movementType: 'COUNT_ADJUSTMENT' }
        });
        console.log(`Found ${ledgers.length} COUNT_ADJUSTMENT ledgers in total.`);
        if (ledgers.length > 0) {
            console.log(JSON.stringify(ledgers.slice(0, 3), null, 2));
        }
    } finally {
        await prisma.$disconnect();
    }
}
run();
