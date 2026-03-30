'use strict';

const prisma = require('../config/database');
const { connectRole } = require('./rbac.service');

/** Fixed order: Dept Manager → Finance → Admin (final). */
const TRANSFER_APPROVAL_ROLE_CODES = ['DEPT_MANAGER', 'FINANCE_MANAGER', 'ADMIN'];

const transferStatusForActiveStep = (stepNumber) => {
    if (stepNumber === 1) return 'PENDING_DEPT';
    if (stepNumber === 2) return 'PENDING_FINANCE';
    if (stepNumber === 3) return 'PENDING_FINAL';
    return 'PENDING_DEPT';
};

/**
 * Create 3-step approval for a store transfer (call inside a transaction).
 */
const createStoreTransferApprovalRequest = async (tx, { tenantId, transferId, createdBy }) => {
    await tx.approvalRequest.create({
        data: {
            tenantId,
            requestType: 'STORE_TRANSFER',
            status: 'PENDING',
            storeTransferId: transferId,
            currentStep: 1,
            totalSteps: TRANSFER_APPROVAL_ROLE_CODES.length,
            createdBy,
            steps: {
                create: TRANSFER_APPROVAL_ROLE_CODES.map((code, i) => ({
                    stepNumber: i + 1,
                    requiredRole: connectRole(code),
                    status: 'PENDING',
                })),
            },
        },
    });
};

/**
 * Approve or reject the current step of a transfer-linked approval request.
 */
const processStoreTransferApproval = async ({
    transferId,
    tenantId,
    userId,
    userRole,
    action,
    comment,
}) => {
    const trf = await prisma.storeTransfer.findFirst({
        where: { id: transferId, tenantId },
        include: {
            approvalRequest: {
                include: {
                    steps: { orderBy: { stepNumber: 'asc' }, include: { requiredRole: { select: { code: true } } } },
                },
            },
        },
    });

    if (!trf?.approvalRequest) {
        throw Object.assign(new Error('No approval workflow found for this transfer.'), { statusCode: 404 });
    }

    const approval = trf.approvalRequest;
    const currentStepNo = approval.currentStep;
    const step = approval.steps.find((s) => s.stepNumber === currentStepNo);

    if (!step || step.status !== 'PENDING') {
        throw Object.assign(new Error('No pending approval step for this transfer.'), { statusCode: 422 });
    }

    const requiredCode = step.requiredRole?.code;
    const canActAtStep =
        userRole === requiredCode ||
        userRole === 'ADMIN' ||
        userRole === 'SUPER_ADMIN';
    if (!canActAtStep) {
        throw Object.assign(
            new Error(
                action === 'REJECT'
                    ? 'You are not authorized to reject at this step.'
                    : `Step ${currentStepNo} requires role ${requiredCode}. Your role: ${userRole}`
            ),
            { statusCode: 403 }
        );
    }

    const now = new Date();

    return prisma.$transaction(async (tx) => {
        if (action === 'REJECT') {
            await tx.approvalStep.update({
                where: { id: step.id },
                data: {
                    status: 'REJECTED',
                    actedBy: userId,
                    actedAt: now,
                    comment: comment || null,
                },
            });
            await tx.approvalRequest.update({
                where: { id: approval.id },
                data: { status: 'REJECTED', resolvedAt: now, currentStep: currentStepNo },
            });
            await tx.approvalStep.updateMany({
                where: {
                    requestId: approval.id,
                    stepNumber: { gt: currentStepNo },
                    status: 'PENDING',
                },
                data: { status: 'CANCELLED' },
            });
            return tx.storeTransfer.update({
                where: { id: transferId },
                data: {
                    status: 'REJECTED',
                    rejectedBy: userId,
                    rejectionReason: comment || 'Rejected',
                    updatedAt: now,
                },
                include: { lines: true, sourceLocation: true, destLocation: true },
            });
        }

        await tx.approvalStep.update({
            where: { id: step.id },
            data: {
                status: 'APPROVED',
                actedBy: userId,
                actedAt: now,
                comment: comment || null,
            },
        });

        const isFinal = currentStepNo >= approval.totalSteps;

        if (isFinal) {
            await tx.approvalRequest.update({
                where: { id: approval.id },
                data: { status: 'APPROVED', resolvedAt: now, currentStep: currentStepNo },
            });
            return tx.storeTransfer.update({
                where: { id: transferId },
                data: {
                    status: 'APPROVED',
                    approvedBy: userId,
                    approvedAt: now,
                    updatedAt: now,
                },
                include: { lines: true, sourceLocation: true, destLocation: true },
            });
        }

        const nextStepNo = currentStepNo + 1;
        await tx.approvalRequest.update({
            where: { id: approval.id },
            data: { currentStep: nextStepNo },
        });

        return tx.storeTransfer.update({
            where: { id: transferId },
            data: {
                status: transferStatusForActiveStep(nextStepNo),
                updatedAt: now,
            },
            include: { lines: true, sourceLocation: true, destLocation: true },
        });
    });
};

module.exports = {
    TRANSFER_APPROVAL_ROLE_CODES,
    transferStatusForActiveStep,
    createStoreTransferApprovalRequest,
    processStoreTransferApproval,
};
