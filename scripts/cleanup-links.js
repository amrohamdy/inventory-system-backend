const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        // Find all categories
        const cats = await prisma.category.findMany({
            include: { department: { include: { locations: true } } }
        });

        console.log(`Checking ${cats.length} categories...`);

        let removed = 0;
        let keptOrAdded = 0;

        for (const cat of cats) {
            // Find distinct locations where this category actually has stock
            const balances = await prisma.stockBalance.findMany({
                where: { item: { categoryId: cat.id }, qtyOnHand: { gt: 0 } },
                select: { locationId: true },
                distinct: ['locationId']
            });

            const activeLocationIds = new Set(balances.map(b => b.locationId));

            // Delete all current links for this category
            const delRes = await prisma.locationCategory.deleteMany({
                where: { categoryId: cat.id }
            });
            removed += delRes.count;

            // Link only to active locations
            if (activeLocationIds.size > 0) {
                for (const locId of activeLocationIds) {
                    await prisma.locationCategory.create({
                        data: { categoryId: cat.id, locationId: locId }
                    });
                    keptOrAdded++;
                }
                console.log(`Category ${cat.name} -> linked to ${activeLocationIds.size} active locations.`);
            } else {
                // No stock? Link to department's first location so it's not orphaned
                if (cat.department && cat.department.locations.length > 0) {
                    const firstLocId = cat.department.locations[0].id;
                    await prisma.locationCategory.create({
                        data: { categoryId: cat.id, locationId: firstLocId }
                    });
                    keptOrAdded++;
                    console.log(`Category ${cat.name} -> had no stock, linked to default location.`);
                }
            }
        }
        console.log(`Cleanup complete. Removed ${removed} old links, created ${keptOrAdded} precise links.`);
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
