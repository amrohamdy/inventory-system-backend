const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        const ledgers = await prisma.inventoryLedger.findMany({
            where: {
                movementType: { in: ['RECEIVE', 'BREAKAGE'] },
                item: { category: { name: 'Apartment utensils' } }
            }
        });
        console.log(`Found ${ledgers.length} ledgers for RECEIVE or BREAKAGE for Apartment utensils`);
        if(ledgers.length > 0) {
            console.log(JSON.stringify(ledgers.slice(0, 3), null, 2));
        }
    } finally {
        await prisma.$disconnect();
    }
}
run();
