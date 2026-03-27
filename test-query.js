const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
    try {
        const tenant = await prisma.tenant.findFirst();
        console.log("Tenant:", tenant.id);
        const loans = await prisma.assetLoan.findMany({
            where: { tenantId: tenant.id },
            include: {
                item: { select: { name: true, imageUrl: true } },
                location: { select: { name: true } },
                createdByUser: { select: { firstName: true, lastName: true } }
            },
            orderBy: { outDate: 'desc' }
        });
        console.log("Success:", loans);
    } catch (err) {
        console.error("Prisma Error:", err);
    } finally {
        await prisma.$disconnect();
    }
}
test();
