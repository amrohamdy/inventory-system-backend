const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        const count = await prisma.locationCategory.count();
        console.log('Total LocationCategory links found in database:', count);
        
        if (count === 0) {
            console.log('No location category links found! Automatically mapping all categories to their department locations...');
            const departments = await prisma.department.findMany({ 
                include: { locations: true, categories: true } 
            });
            
            let addedCount = 0;
            for (const dept of departments) {
                for (const loc of dept.locations) {
                    for (const cat of dept.categories) {
                        try {
                            await prisma.locationCategory.create({
                                data: {
                                    locationId: loc.id,
                                    categoryId: cat.id
                                }
                            });
                            addedCount++;
                        } catch (err) {
                            // ignore unique constraint errors if any
                        }
                    }
                }
            }
            console.log(`Successfully mapped ${addedCount} Category-Location relationships!`);
        } else {
            console.log('Database already has mapped location categories. No auto-linking performed.');
        }
    } catch (error) {
        console.error('Error during auto-linking:', error);
    } finally {
        await prisma.$disconnect();
    }
}

run();
