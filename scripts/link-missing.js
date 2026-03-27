const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        const cats = await prisma.category.findMany({
            include: {
                locationCategories: true,
                department: {
                    include: {
                        locations: true
                    }
                }
            }
        });

        let count = 0;
        for (const c of cats) {
            if (c.locationCategories.length === 0) {
                console.log(`Linking category ${c.name}...`);
                for (const l of c.department.locations) {
                    await prisma.locationCategory.create({
                        data: {
                            categoryId: c.id,
                            locationId: l.id
                        }
                    });
                    count++;
                }
            }
        }
        console.log(`Added ${count} missing links`);
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
