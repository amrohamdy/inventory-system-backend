/**
 * One-time RBAC sync:
 * Grant ORG_MANAGER all permission codes currently available in the DB.
 *
 * Usage:
 *   node scripts/grant-org-manager-permissions.js
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
    const orgManagerRole = await prisma.role.findUnique({
        where: { code: 'ORG_MANAGER' },
        select: { id: true, code: true },
    });
    if (!orgManagerRole) {
        throw new Error('ORG_MANAGER role not found. Run: node seed-super-admin.js');
    }

    const permissions = await prisma.permission.findMany({
        select: { id: true, code: true },
    });
    if (permissions.length === 0) {
        throw new Error('No permissions found. Seed permissions first (node seed-super-admin.js).');
    }

    const permissionIds = permissions.map((p) => p.id);

    const removed = await prisma.rolePermission.deleteMany({
        where: {
            roleId: orgManagerRole.id,
            permissionId: { notIn: permissionIds },
        },
    });

    let added = 0;
    for (const perm of permissions) {
        await prisma.rolePermission.upsert({
            where: {
                roleId_permissionId: {
                    roleId: orgManagerRole.id,
                    permissionId: perm.id,
                },
            },
            create: {
                roleId: orgManagerRole.id,
                permissionId: perm.id,
            },
            update: {},
        });
        added += 1;
    }

    console.log(`ORG_MANAGER permission sync complete.`);
    console.log(`Permissions available: ${permissions.length}`);
    console.log(`Links ensured: ${added}`);
    console.log(`Stale links removed: ${removed.count}`);
}

main()
    .catch((err) => {
        console.error('Failed to sync ORG_MANAGER permissions:', err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
