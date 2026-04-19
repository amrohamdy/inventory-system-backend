/**
 * Verifies GENERAL_MANAGER exists with executive view/audit permissions (aligned with authorize.js).
 * Get Pass final approval is enforced by role (GENERAL_MANAGER) in getPass.service.js, not route permissions.
 *
 * Run after seeding:
 *   node seed-super-admin.js && node scripts/verify-general-manager-rbac.js
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const REQUIRED = [
    'GET_PASS_VIEW',
    'GET_PASS_APPROVE_FINAL',
    'VIEW_DASHBOARD',
    'DASHBOARD_VIEW',
    'BASIC_DATA_VIEW',
    'INVENTORY_VIEW',
    'REPORTS_VIEW',
    'REPORTS_EXPORT',
    'STOCK_COUNT_VIEW',
    'GRN_VIEW',
    'AUDIT_LOG_VIEW',
];

async function main() {
    const role = await prisma.role.findUnique({
        where: { code: 'GENERAL_MANAGER' },
        include: {
            rolePermissions: {
                include: { permission: { select: { code: true } } },
            },
        },
    });

    if (!role) {
        console.error('❌ Role GENERAL_MANAGER not found. Run: node seed-super-admin.js');
        process.exit(1);
    }

    const codes = new Set(role.rolePermissions.map((rp) => rp.permission.code));
    const missing = REQUIRED.filter((c) => !codes.has(c));

    if (missing.length > 0) {
        console.error('❌ GENERAL_MANAGER missing permissions:', missing.join(', '));
        console.error('   Granted:', [...codes].sort().join(', ') || '(none)');
        process.exit(1);
    }

    console.log('✅ GENERAL_MANAGER role OK with permissions:', REQUIRED.join(', '));
}

main()
    .catch((e) => {
        console.error('❌', e.message);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
