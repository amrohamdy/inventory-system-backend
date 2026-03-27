const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
p.user.findMany({
    select: { email: true, role: true, tenant: { select: { slug: true } } }
}).then(r => {
    r.forEach(u => console.log(u.tenant?.slug, '|', u.email, '|', u.role));
    return p.$disconnect();
});
