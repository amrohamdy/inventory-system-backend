const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { approveStockCount } = require('./src/services/stockCount.service');

async function approveLatest() {
    // Find the latest PENDING_APPROVAL session
    const session = await prisma.stockCountSession.findFirst({
        where: { status: 'PENDING_APPROVAL' },
        orderBy: { snapshotAt: 'desc' }
    });

    if (!session) {
        console.log("No pending session found.");
        return;
    }

    // Get the users
    const hod = await prisma.user.findFirst({ where: { role: 'DEPARTMENT_HEAD' } });
    const cost = await prisma.user.findFirst({ where: { role: 'COST_CONTROLLER' } });
    const finance = await prisma.user.findFirst({ where: { role: 'FINANCE_MANAGER' } });

    console.log(`Approving session ${session.sessionNo}...`);
    await approveStockCount(session.id, { role: 'DEPARTMENT_HEAD', id: hod.id, firstName: "HOD", lastName: "Test" }, 'APPROVE', 'HOD Approved');
    await approveStockCount(session.id, { role: 'COST_CONTROLLER', id: cost.id, firstName: "Cost", lastName: "Test" }, 'APPROVE', 'Cost Approved');
    await approveStockCount(session.id, { role: 'FINANCE_MANAGER', id: finance.id, firstName: "Finance", lastName: "Test" }, 'APPROVE', 'Finance Approved - POSTING');

    console.log(`Session ${session.sessionNo} should now be POSTED.`);
}

approveLatest().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
