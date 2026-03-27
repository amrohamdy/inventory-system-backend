const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * ============================================================================
 * PERIOD GUARD — Shared Control Layer
 * ============================================================================
 * Enforces immutability of closed periods across the entire system.
 * 
 * Rules:
 *  1. No transaction with a date inside a closed period
 *  2. No OPENING_BALANCE entry when OB is locked
 *  3. No Stock Count session when period is closed
 *
 * Usage:
 *   const { checkPeriodLock, checkOBAllowed } = require('./periodGuard.service');
 *   await checkPeriodLock(tenantId, transactionDate);       // throws if locked
 *   await checkOBAllowed(tenantId);                         // throws if OB locked
 * ============================================================================
 */

/**
 * Checks if a given transaction date falls inside a closed period.
 * Throws a clear error if the period is locked.
 *
 * @param {string} tenantId
 * @param {Date|string} transactionDate
 */
const checkPeriodLock = async (tenantId, transactionDate) => {
    const txDate = transactionDate ? new Date(transactionDate) : new Date();
    const txYear = txDate.getFullYear();
    const txMonth = txDate.getMonth() + 1; // 1–12

    // 1. Check if the full year is closed (annual close)
    const annualClose = await prisma.periodClose.findFirst({
        where: {
            tenantId,
            year: txYear,
            month: null,
            status: 'CLOSED',
        },
    });

    if (annualClose) {
        throw Object.assign(
            new Error(`لا يمكن إنشاء حركة داخل سنة مغلقة (${txYear}). يُرجى استخدام حركة تصحيح في السنة الحالية.`),
            { status: 422, code: 'PERIOD_LOCKED_ANNUAL' }
        );
    }

    // 2. Check if the specific month is closed (monthly close)
    const monthlyClose = await prisma.periodClose.findFirst({
        where: {
            tenantId,
            year: txYear,
            month: txMonth,
            status: 'CLOSED',
        },
    });

    if (monthlyClose) {
        const monthName = txDate.toLocaleString('en-US', { month: 'long' });
        throw Object.assign(
            new Error(`لا يمكن إنشاء حركة داخل فترة مغلقة (${monthName} ${txYear}). يُرجى استخدام حركة تصحيح في الفترة الحالية.`),
            { status: 422, code: 'PERIOD_LOCKED_MONTHLY' }
        );
    }

    // 3. Check previous year annual close (for backdated transactions to prior year)
    const prevYear = txYear - 1;
    // Only applies if the txDate is in the current year but references prior year
    // This is handled by the annual check above, but we also check prior year explicitly
    // in case someone tries to post a document dated in prior year after it was closed
    const prevAnnualClose = await prisma.periodClose.findFirst({
        where: {
            tenantId,
            year: prevYear,
            month: null,
            status: 'CLOSED',
        },
    });

    if (prevAnnualClose && txYear <= prevYear) {
        throw Object.assign(
            new Error(`لا يمكن تعديل بيانات سنة تم إغلاقها (${prevYear}). أي تصحيح يتم من خلال حركة في السنة الحالية.`),
            { status: 422, code: 'PERIOD_LOCKED_PREV_YEAR' }
        );
    }
};

/**
 * Checks if Opening Balance entry is currently allowed.
 * Throws if OB is locked (either manually or auto-locked after close).
 *
 * @param {string} tenantId
 */
const checkOBAllowed = async (tenantId) => {
    const setting = await prisma.tenantSetting.findUnique({
        where: { tenantId_key: { tenantId, key: 'allowOpeningBalance' } },
    });

    // If setting doesn't exist → OB is allowed (system never locked it)
    if (!setting) return;

    if (setting.value === 'LOCKED') {
        throw Object.assign(
            new Error(`Opening Balance غير مسموح بعد إغلاق السنة السابقة. أي تعديل يتم من خلال Adjustment فقط.`),
            { status: 422, code: 'OB_LOCKED' }
        );
    }
};

/**
 * Combined check for Opening Balance movements specifically.
 * Checks both OB lock and period lock.
 *
 * @param {string} tenantId
 * @param {Date|string} transactionDate
 */
const checkOpeningBalanceAllowed = async (tenantId, transactionDate) => {
    await checkOBAllowed(tenantId);
    await checkPeriodLock(tenantId, transactionDate);
};

/**
 * Returns the current OB setting status for display in UI.
 *
 * @param {string} tenantId
 * @returns {{ allowed: boolean, reason: string|null, lockedAt: Date|null }}
 */
const getOBStatus = async (tenantId) => {
    const setting = await prisma.tenantSetting.findUnique({
        where: { tenantId_key: { tenantId, key: 'allowOpeningBalance' } },
    });

    if (!setting || setting.value !== 'LOCKED') {
        return { allowed: true, reason: null };
    }

    return {
        allowed: false,
        reason: setting.reason || 'Locked by system',
        updatedAt: setting.updatedAt || null,
    };
};

module.exports = {
    checkPeriodLock,
    checkOBAllowed,
    checkOpeningBalanceAllowed,
    getOBStatus,
};
