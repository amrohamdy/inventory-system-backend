/**
 * One-time script: Convert absolute imageUrls to relative paths in DB
 * Run from backend/ directory: node fix-image-urls.js
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // Find all items with imageUrl containing http (absolute URLs)
    const items = await prisma.item.findMany({
        where: { imageUrl: { contains: 'http' } },
        select: { id: true, imageUrl: true, name: true },
    });

    console.log(`Found ${items.length} items with absolute image URLs`);

    let fixed = 0;
    for (const item of items) {
        // Extract the /uploads/... part from the absolute URL
        const match = item.imageUrl.match(/(\/uploads\/.+)/);
        if (match) {
            const relativeUrl = match[1];
            await prisma.item.update({
                where: { id: item.id },
                data: { imageUrl: relativeUrl },
            });
            console.log(`  Fixed: ${item.name} → ${relativeUrl}`);
            fixed++;
        } else {
            console.log(`  Skipped (no /uploads path): ${item.name} → ${item.imageUrl}`);
        }
    }

    console.log(`\nDone. Fixed ${fixed}/${items.length} items.`);
    await prisma.$disconnect();
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
