const {PrismaClient} = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();

async function main() {
    const hash = await bcrypt.hash('Admin@123', 12);
    const u = await p.user.update({
        where: { id: (await p.user.findFirst({ where: { email: 'admin@admin.com' } })).id },
        data: { passwordHash: hash }
    });
    console.log('Password reset for:', u.email);
    await p.$disconnect();
}
main().catch(console.error);
