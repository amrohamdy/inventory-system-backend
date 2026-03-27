'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function deleteItems() {
    console.log('🗑️ Deleting all items and related data...\n');

    // Delete in dependency order
    const steps = [
        ['itemUnit',      () => prisma.itemUnit.deleteMany({})],
        ['itemMapping',   () => prisma.itemMapping.deleteMany({})],
        ['uomMapping',    () => prisma.uomMapping.deleteMany({})],
        ['vendorMapping', () => prisma.vendorMapping.deleteMany({})],
        ['item',          () => prisma.item.deleteMany({})],
    ];

    for (const [name, fn] of steps) {
        try {
            const r = await fn();
            console.log(`  ✅ ${name.padEnd(20)} → ${r.count} deleted`);
        } catch (err) {
            if (err.code === 'P2021') {
                console.log(`  ⏭️  ${name.padEnd(20)} → table not found`);
            } else {
                console.log(`  ⚠️  ${name.padEnd(20)} → ${err.message.split('\n')[0]}`);
            }
        }
    }

    const remaining = await prisma.item.count();
    console.log(`\n✅ Done! Items remaining: ${remaining}`);
}

deleteItems().catch(console.error).finally(() => prisma.$disconnect());
