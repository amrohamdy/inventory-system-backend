const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function main() {
    const items = await p.item.count();
    const balances = await p.stockBalance.count();
    console.log('Items in master:', items);
    console.log('Stock balances:', balances);
}
main().finally(() => p.$disconnect());
