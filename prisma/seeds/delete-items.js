const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.item.deleteMany({})
    .then(r => { console.log('✅ Deleted', r.count, 'items'); })
    .catch(e => console.error('❌', e.message))
    .finally(() => p.$disconnect());
