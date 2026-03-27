const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
    const cat = await prisma.category.findFirst({ where: { name: 'Apartment utensils' } });
    if (!cat) return console.log('Category not found');
    const links = await prisma.locationCategory.findMany({ where: { categoryId: cat.id }, include: { location: true } });
    console.log('Location Links for category: [' + links.map(l => l.location.name).join(', ') + ']');
    
    const items = await prisma.item.count({ where: { categoryId: cat.id } });
    console.log('Total Items in category:', items);
}
run().finally(() => prisma.$disconnect());
