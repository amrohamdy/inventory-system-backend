'use strict';
// Supplemental cleanup for misnamed models
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('🧹 Supplemental cleanup...\n');

    // Find the correct model names by inspecting prisma client
    const modelNames = Object.keys(prisma).filter(k => !k.startsWith('_') && !k.startsWith('$'));
    console.log('Available models:', modelNames.join(', '), '\n');

    // Try to delete remaining breakage/GRN related
    const toTry = [
        'breakageDocument', 'breakageItem',
        'grnLine', 'grnImportLine', 'grnHeader',
        'movementDocument', 'movement',
        'auditTrail', 'auditLog',
        'notification', 'alertNotification',
        'stockCountEntry', 'countEntry',
    ];

    for (const model of toTry) {
        if (prisma[model]) {
            try {
                const result = await prisma[model].deleteMany({});
                console.log(`  ✅ ${model.padEnd(30)} → ${result.count} records deleted`);
            } catch (err) {
                console.log(`  ⚠️  ${model.padEnd(30)} → ${err.message.split('\n')[0]}`);
            }
        }
    }

    console.log('\n✅ Done!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
