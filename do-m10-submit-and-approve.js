const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { submitForApproval, processApproval } = require('./src/services/stockCount.service');

async function approveLatest() {
    // Find the latest DRAFT session
    const session = await prisma.stockCountSession.findFirst({
        where: { status: 'DRAFT' },
        orderBy: { snapshotAt: 'desc' }
    });

    if (!session) {
        console.log("No DRAFT session found.");
        return;
    }

    console.log(`Submitting session ${session.sessionNo}...`);
    // Mock user for submission
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    await submitForApproval(session.id, session.tenantId, admin.id);

    // Get the approvers
    const hod = await prisma.user.findFirst({ where: { role: 'DEPT_MANAGER' } });
    const cost = await prisma.user.findFirst({ where: { role: 'COST_CONTROL' } });
    const finance = await prisma.user.findFirst({ where: { role: 'FINANCE_MANAGER' } });

    console.log(`Approving session ${session.sessionNo}...`);
    await processApproval(session.id, session.tenantId, { role: 'DEPT_MANAGER', id: hod.id }, 'HOD Approved', true);
    await processApproval(session.id, session.tenantId, { role: 'COST_CONTROL', id: cost.id }, 'Cost Approved', true);
    await processApproval(session.id, session.tenantId, { role: 'FINANCE_MANAGER', id: finance.id }, 'Finance Approved - POSTING', true);

    console.log(`Session ${session.sessionNo} is now POSTED.`);
}

approveLatest().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
