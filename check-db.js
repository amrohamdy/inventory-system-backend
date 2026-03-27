const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user.findMany({ select: { email: true, role: true, tenant: { select: { slug: true } } }, take: 10 })
    .then(users => {
        console.log('Users in DB:');
        users.forEach(u => console.log(`  ${u.tenant.slug} | ${u.email} | ${u.role}`));
    })
    .catch(e => console.error('ERROR:', e.message))
    .finally(() => p.$disconnect());
