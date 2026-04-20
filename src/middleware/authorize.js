/**
 * M01 — Role-Based Authorization Middleware (DB-backed permissions via JWT)
 * Usage: authorize('ADMIN', 'COST_CONTROL')  →  only those roles can proceed
 */
const { normalizeRole } = require('../services/rbac.service');

const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Authentication required.' });
        }

        const normalizedRoles = roles.map((r) => normalizeRole(r));
        const userRole = normalizeRole(req.user.role);
        const canActAsAdmin = userRole === 'ORG_MANAGER' && normalizedRoles.includes('ADMIN');

        if (!normalizedRoles.includes(userRole) && !canActAsAdmin) {
            return res.status(403).json({
                success: false,
                message: `Access denied. Required role(s): ${roles.join(', ')}. Your role: ${req.user.role}`,
            });
        }

        next();
    };
};

/**
 * Canonical permission matrix keys (Excel-aligned). Aliases resolve to these.
 * Kept for documentation and tests; enforcement uses JWT `permissions` from DB.
 */
const PERMISSIONS = {
    BASIC_DATA_EDIT: ['ADMIN', 'ORG_MANAGER'],
    BASIC_DATA_VIEW: [
        'ADMIN',
        'STOREKEEPER',
        'DEPT_MANAGER',
        'COST_CONTROL',
        'FINANCE_MANAGER',
        'AUDITOR',
        'GENERAL_MANAGER',
        'ORG_MANAGER',
    ],

    INVENTORY_VIEW: [
        'ADMIN',
        'STOREKEEPER',
        'DEPT_MANAGER',
        'COST_CONTROL',
        'FINANCE_MANAGER',
        'AUDITOR',
        'GENERAL_MANAGER',
        'ORG_MANAGER',
    ],
    MOVEMENT_CREATE: ['ADMIN', 'ORG_MANAGER', 'STOREKEEPER'],
    ISSUE_CREATE: ['ADMIN', 'ORG_MANAGER', 'STOREKEEPER', 'DEPT_MANAGER'],
    ISSUE_APPROVE: ['ADMIN', 'ORG_MANAGER', 'DEPT_MANAGER', 'COST_CONTROL', 'FINANCE_MANAGER'],
    TRANSFER_CREATE: ['ADMIN', 'ORG_MANAGER', 'STOREKEEPER'],
    TRANSFER_APPROVE: ['ADMIN', 'ORG_MANAGER', 'DEPT_MANAGER', 'FINANCE_MANAGER'],
    TRANSFER_DISPATCH_RECEIVE: ['ADMIN', 'ORG_MANAGER', 'STOREKEEPER'],

    GRN_VIEW: [
        'ADMIN',
        'STOREKEEPER',
        'DEPT_MANAGER',
        'COST_CONTROL',
        'FINANCE_MANAGER',
        'AUDITOR',
        'GENERAL_MANAGER',
        'ORG_MANAGER',
    ],
    GRN_MANAGE: ['ADMIN', 'ORG_MANAGER', 'STOREKEEPER', 'COST_CONTROL'],

    BREAKAGE_CREATE: ['ADMIN', 'ORG_MANAGER', 'STOREKEEPER', 'DEPT_MANAGER'],
    ADJUSTMENT_CREATE: ['ADMIN', 'ORG_MANAGER', 'STOREKEEPER'],
    /** Breakage workflow approve/reject (JWT `permissions.code` = APPROVE_BREAKAGE). GM acts on final step. */
    APPROVE_BREAKAGE: ['ADMIN', 'ORG_MANAGER', 'DEPT_MANAGER', 'COST_CONTROL', 'FINANCE_MANAGER', 'GENERAL_MANAGER'],

    STOCK_COUNT_MANAGE: ['ADMIN', 'ORG_MANAGER', 'STOREKEEPER'],
    STOCK_COUNT_VIEW: [
        'ADMIN',
        'STOREKEEPER',
        'COST_CONTROL',
        'FINANCE_MANAGER',
        'AUDITOR',
        'GENERAL_MANAGER',
        'ORG_MANAGER',
    ],

    REPORTS_VIEW: [
        'ADMIN',
        'STOREKEEPER',
        'DEPT_MANAGER',
        'COST_CONTROL',
        'FINANCE_MANAGER',
        'AUDITOR',
        'GENERAL_MANAGER',
        'ORG_MANAGER',
    ],

    /** Sidebar + read access to Breakage & Loss (Transactions); API may also use VIEW_INVENTORY. */
    BREAKAGE_VIEW: ['ADMIN', 'ORG_MANAGER', 'SUPER_ADMIN', 'DEPT_MANAGER'],

    /** DB/JWT-friendly read flags for breakage / lost lists (also aliased to INVENTORY_VIEW for checks). */
    READ_BREAKAGE: ['COST_CONTROL', 'FINANCE_MANAGER', 'GENERAL_MANAGER', 'ADMIN', 'ORG_MANAGER', 'SUPER_ADMIN'],
    READ_LOST: ['COST_CONTROL', 'FINANCE_MANAGER', 'GENERAL_MANAGER', 'ADMIN', 'ORG_MANAGER', 'SUPER_ADMIN'],

    /** Get Pass loan write-offs (lost qty) — ledger LOAN_WRITE_OFF linked to GetPassReturn. */
    LOST_ITEMS_VIEW: ['ADMIN', 'ORG_MANAGER', 'GENERAL_MANAGER', 'DEPT_MANAGER'],
    /** Lost-items workflow approve/reject (JWT `permissions.code` = APPROVE_LOST). */
    APPROVE_LOST: ['ADMIN', 'ORG_MANAGER', 'DEPT_MANAGER', 'COST_CONTROL', 'FINANCE_MANAGER', 'GENERAL_MANAGER'],
    REPORTS_EXPORT: [
        'ADMIN',
        'STOREKEEPER',
        'COST_CONTROL',
        'FINANCE_MANAGER',
        'AUDITOR',
        'GENERAL_MANAGER',
        'ORG_MANAGER',
    ],

    VIEW_DASHBOARD: [
        'ADMIN',
        'STOREKEEPER',
        'DEPT_MANAGER',
        'COST_CONTROL',
        'FINANCE_MANAGER',
        'AUDITOR',
        'GENERAL_MANAGER',
        'ORG_MANAGER',
        'SECURITY',
    ],

    /**
     * Full dashboard analytics API (role-scoped summary) — enforced on /dashboard/summary + /dashboard/charts.
     * JWT/DB code: DASHBOARD_VIEW (replaces legacy DASHBOARD_ADMIN_VIEW).
     */
    DASHBOARD_VIEW: [
        'ADMIN',
        'ORG_MANAGER',
        'DEPT_MANAGER',
        'COST_CONTROL',
        'FINANCE_MANAGER',
        'GENERAL_MANAGER',
        'SECURITY',
        'STOREKEEPER',
        'AUDITOR',
    ],

    GET_PASS_CREATE: ['ADMIN', 'ORG_MANAGER', 'STOREKEEPER', 'DEPT_MANAGER'],
    GET_PASS_VIEW: [
        'ADMIN',
        'STOREKEEPER',
        'DEPT_MANAGER',
        'COST_CONTROL',
        'SECURITY',
        'FINANCE_MANAGER',
        'AUDITOR',
        'GENERAL_MANAGER',
        'ORG_MANAGER',
    ],
    GET_PASS_APPROVE: ['ADMIN', 'ORG_MANAGER'],
    GET_PASS_APPROVE_FINAL: ['GENERAL_MANAGER', 'ORG_MANAGER', 'SECURITY'],
    GET_PASS_APPROVE_EXIT: ['ADMIN', 'ORG_MANAGER', 'SECURITY'],
    GET_PASS_APPROVE_RETURN: ['ADMIN', 'ORG_MANAGER', 'SECURITY'],
    /** Internal transfer: destination hotel confirms physical receipt. */
    GET_PASS_CONFIRM_DESTINATION: ['ADMIN', 'ORG_MANAGER', 'SECURITY', 'GENERAL_MANAGER'],

    IMPORT_CREATE: ['ADMIN', 'ORG_MANAGER', 'STOREKEEPER'],
    IMPORT_EXCEL: ['ADMIN', 'ORG_MANAGER', 'STOREKEEPER'],

    USERS_COMPANY_MANAGE: ['ADMIN', 'ORG_MANAGER'],
    SETTINGS_MANAGE: ['ADMIN', 'ORG_MANAGER'],
    AUDIT_LOG_VIEW: ['ADMIN', 'ORG_MANAGER', 'FINANCE_MANAGER', 'AUDITOR', 'GENERAL_MANAGER'],
    STOCK_MANAGE: ['ADMIN', 'ORG_MANAGER', 'STOREKEEPER'],
    ITEM_MANAGE: ['ADMIN', 'ORG_MANAGER'],
    BREAKAGE_APPROVE: ['ADMIN', 'ORG_MANAGER', 'DEPT_MANAGER', 'COST_CONTROL', 'FINANCE_MANAGER', 'GENERAL_MANAGER'],
    LOST_CREATE: ['ADMIN', 'ORG_MANAGER', 'STOREKEEPER', 'DEPT_MANAGER'],
    USER_MANAGE: ['ADMIN', 'ORG_MANAGER'],
    TENANT_MANAGE: ['ADMIN', 'ORG_MANAGER'],
};

const PERMISSION_ALIASES = {
    MANAGE_MASTER_DATA: 'BASIC_DATA_EDIT',
    VIEW_MASTER_DATA: 'BASIC_DATA_VIEW',
    MANAGE_INVENTORY: 'MOVEMENT_CREATE',
    VIEW_INVENTORY: 'INVENTORY_VIEW',
    CREATE_MOVEMENT: 'MOVEMENT_CREATE',
    CREATE_ISSUE: 'ISSUE_CREATE',
    VIEW_MOVEMENTS: 'INVENTORY_VIEW',
    CREATE_BREAKAGE: 'BREAKAGE_CREATE',
    /** Same matrix row as BREAKAGE_CREATE; lost manual create opens the same 4-step workflow from DEPT_APPROVED. */
    CREATE_LOST: 'BREAKAGE_CREATE',
    CREATE_ADJUSTMENT: 'ADJUSTMENT_CREATE',
    /** Legacy Excel/matrix keys → canonical JWT codes (Prisma `permissions.code`). */
    BREAKAGE_APPROVE_REJECT: 'APPROVE_BREAKAGE',
    LOST_APPROVE_REJECT: 'APPROVE_LOST',
    MANAGE_COUNT: 'STOCK_COUNT_MANAGE',
    VIEW_COUNT: 'STOCK_COUNT_VIEW',
    VIEW_REPORTS: 'REPORTS_VIEW',
    EXPORT_REPORTS: 'REPORTS_EXPORT',
    MANAGE_USERS: 'USERS_COMPANY_MANAGE',
    MANAGE_SETTINGS: 'SETTINGS_MANAGE',
    VIEW_AUDIT_LOG: 'AUDIT_LOG_VIEW',
    MANAGE_IMPORTS: 'IMPORT_EXCEL',
    STOCK_MANAGE: 'MOVEMENT_CREATE',
    ITEM_MANAGE: 'BASIC_DATA_EDIT',
    BREAKAGE_APPROVE: 'APPROVE_BREAKAGE',
    LOST_CREATE: 'BREAKAGE_CREATE',
    USER_MANAGE: 'USERS_COMPANY_MANAGE',
    TENANT_MANAGE: 'SETTINGS_MANAGE',
    CREATE_GET_PASS: 'GET_PASS_CREATE',
    VIEW_GET_PASS: 'GET_PASS_VIEW',
    REGISTER_GET_PASS_RETURN: 'GET_PASS_APPROVE_RETURN',
    /** JWT may store friendly codes; resolve to canonical matrix keys for route checks. */
    READ_BREAKAGE: 'INVENTORY_VIEW',
    READ_LOST: 'INVENTORY_VIEW',
};

const resolvePermissionKey = (permission) => PERMISSION_ALIASES[permission] || permission;

/**
 * Legacy sync helper: compute permission list from role code using static matrix.
 * Prefer JWT `permissions` at runtime; used when building responses without DB.
 */
const getPermissionsForRole = (role) => {
    const normalizedRole = normalizeRole(role);
    if (!normalizedRole) return [];
    const permissions = Object.entries(PERMISSIONS)
        .filter(([, roles]) => roles.includes(normalizedRole))
        .map(([permission]) => permission);
    if (permissions.length > 0) return permissions;

    if (normalizedRole === 'ORG_MANAGER' || normalizedRole === 'SUPER_ADMIN') {
        return Object.entries(PERMISSIONS)
            .filter(([, roles]) => roles.includes('ADMIN'))
            .map(([permission]) => permission);
    }
    return [];
};

/**
 * Check permission using JWT `permissions` when present; otherwise static matrix fallback.
 * Accepts `{ role, permissions }` or a legacy role string as first argument.
 */
const hasPermission = (userOrRole, permission) => {
    const user = typeof userOrRole === 'string' ? { role: userOrRole } : userOrRole;
    const resolvedPermission = resolvePermissionKey(permission);
    if (user && Array.isArray(user.permissions) && user.permissions.length > 0) {
        if (user.permissions.includes(resolvedPermission)) return true;
        if (user.permissions.includes(permission)) return true;
        if (user.permissions.some((p) => resolvePermissionKey(p) === resolvedPermission)) return true;
    }
    const normalizedRole = normalizeRole(user?.role);
    const allowedRoles = PERMISSIONS[resolvedPermission] || [];
    if (allowedRoles.includes(normalizedRole)) return true;
    if (normalizedRole === 'ORG_MANAGER' || normalizedRole === 'SUPER_ADMIN') {
        return allowedRoles.includes('ADMIN');
    }
    return false;
};

const requirePermission = (permission) => {
    return (req, res, next) => {
        if (!req.user || !hasPermission(req.user, permission)) {
            return res.status(403).json({
                success: false,
                message: `Access denied. Insufficient permissions.`,
                required: permission,
            });
        }
        next();
    };
};

const requireAnyPermission = (...permissions) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(403).json({
                success: false,
                message: `Access denied. Insufficient permissions.`,
                required: permissions,
            });
        }
        const ok = permissions.some((p) => hasPermission(req.user, p));
        if (!ok) {
            return res.status(403).json({
                success: false,
                message: `Access denied. Insufficient permissions.`,
                required: permissions,
            });
        }
        next();
    };
};

module.exports = {
    authorize,
    hasPermission,
    requirePermission,
    requireAnyPermission,
    PERMISSIONS,
    getPermissionsForRole,
    resolvePermissionKey,
};
