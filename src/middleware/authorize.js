/**
 * M01 — Role-Based Authorization Middleware
 * Usage: authorize('ADMIN', 'COST_CONTROL')  →  only those roles can proceed
 */
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Authentication required.' });
        }

        const normalizedRoles = roles.map(r => normalizeRole(r));
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
 * Canonical permission matrix (Excel-aligned)
 */
const PERMISSIONS = {
    BASIC_DATA_EDIT: ['ADMIN'],
    BASIC_DATA_VIEW: ['ADMIN', 'STOREKEEPER', 'DEPT_MANAGER', 'COST_CONTROL', 'FINANCE_MANAGER', 'AUDITOR'],

    INVENTORY_VIEW: ['ADMIN', 'STOREKEEPER', 'DEPT_MANAGER', 'COST_CONTROL', 'FINANCE_MANAGER', 'AUDITOR'],
    MOVEMENT_CREATE: ['ADMIN', 'STOREKEEPER'],
    ISSUE_CREATE: ['ADMIN', 'STOREKEEPER', 'DEPT_MANAGER'],
    ISSUE_APPROVE: ['ADMIN', 'DEPT_MANAGER', 'COST_CONTROL', 'FINANCE_MANAGER'],
    TRANSFER_CREATE: ['ADMIN', 'STOREKEEPER'],
    TRANSFER_APPROVE: ['ADMIN', 'DEPT_MANAGER', 'FINANCE_MANAGER'],
    TRANSFER_DISPATCH_RECEIVE: ['ADMIN', 'STOREKEEPER'],

    GRN_VIEW: ['ADMIN', 'STOREKEEPER', 'DEPT_MANAGER', 'COST_CONTROL', 'FINANCE_MANAGER', 'AUDITOR'],
    GRN_MANAGE: ['ADMIN', 'STOREKEEPER'],

    BREAKAGE_CREATE: ['ADMIN', 'STOREKEEPER', 'DEPT_MANAGER'],
    ADJUSTMENT_CREATE: ['ADMIN', 'STOREKEEPER'],
    BREAKAGE_APPROVE_REJECT: ['ADMIN', 'DEPT_MANAGER', 'COST_CONTROL', 'FINANCE_MANAGER'],

    STOCK_COUNT_MANAGE: ['ADMIN', 'STOREKEEPER'],
    STOCK_COUNT_VIEW: ['ADMIN', 'STOREKEEPER', 'COST_CONTROL', 'FINANCE_MANAGER', 'AUDITOR'],

    REPORTS_VIEW: ['ADMIN', 'STOREKEEPER', 'DEPT_MANAGER', 'COST_CONTROL', 'FINANCE_MANAGER', 'AUDITOR'],
    REPORTS_EXPORT: ['ADMIN', 'STOREKEEPER', 'COST_CONTROL', 'FINANCE_MANAGER', 'AUDITOR'],

    GET_PASS_CREATE: ['ADMIN', 'STOREKEEPER'],
    GET_PASS_VIEW: ['ADMIN', 'STOREKEEPER', 'SECURITY', 'FINANCE_MANAGER', 'AUDITOR'],
    GET_PASS_APPROVE: ['ADMIN', 'SECURITY'],
    GET_PASS_APPROVE_EXIT: ['ADMIN', 'SECURITY'],
    GET_PASS_APPROVE_RETURN: ['ADMIN', 'SECURITY'],

    IMPORT_CREATE: ['ADMIN', 'STOREKEEPER'],
    IMPORT_EXCEL: ['ADMIN', 'STOREKEEPER'],

    USERS_COMPANY_MANAGE: ['ADMIN'],
    SETTINGS_MANAGE: ['ADMIN'],
    AUDIT_LOG_VIEW: ['ADMIN', 'FINANCE_MANAGER', 'AUDITOR', 'SECURITY'],
};

// Backward compatibility for existing routes still using old keys.
const PERMISSION_ALIASES = {
    MANAGE_MASTER_DATA: 'BASIC_DATA_EDIT',
    VIEW_MASTER_DATA: 'BASIC_DATA_VIEW',
    MANAGE_INVENTORY: 'MOVEMENT_CREATE',
    VIEW_INVENTORY: 'INVENTORY_VIEW',
    CREATE_MOVEMENT: 'MOVEMENT_CREATE',
    CREATE_ISSUE: 'ISSUE_CREATE',
    VIEW_MOVEMENTS: 'INVENTORY_VIEW',
    CREATE_BREAKAGE: 'BREAKAGE_CREATE',
    CREATE_ADJUSTMENT: 'ADJUSTMENT_CREATE',
    APPROVE_BREAKAGE: 'BREAKAGE_APPROVE_REJECT',
    MANAGE_COUNT: 'STOCK_COUNT_MANAGE',
    VIEW_COUNT: 'STOCK_COUNT_VIEW',
    VIEW_REPORTS: 'REPORTS_VIEW',
    EXPORT_REPORTS: 'REPORTS_EXPORT',
    MANAGE_USERS: 'USERS_COMPANY_MANAGE',
    MANAGE_SETTINGS: 'SETTINGS_MANAGE',
    VIEW_AUDIT_LOG: 'AUDIT_LOG_VIEW',
    MANAGE_IMPORTS: 'IMPORT_EXCEL',
    CREATE_GET_PASS: 'GET_PASS_CREATE',
    VIEW_GET_PASS: 'GET_PASS_VIEW',
    REGISTER_GET_PASS_RETURN: 'GET_PASS_APPROVE_RETURN',
};

const normalizeRole = (role = '') => {
    const normalized = String(role).toUpperCase();
    // compatibility during migration
    return normalized === 'SECURITY_MANAGER' ? 'SECURITY' : normalized;
};

const resolvePermissionKey = (permission) => PERMISSION_ALIASES[permission] || permission;

const getPermissionsForRole = (role) => {
    const normalizedRole = normalizeRole(role);
    if (!normalizedRole) return [];
    const permissions = Object.entries(PERMISSIONS)
        .filter(([, roles]) => roles.includes(normalizedRole))
        .map(([permission]) => permission);
    if (permissions.length > 0) return permissions;

    // ORG_MANAGER/SUPER_ADMIN are tenant-level admin contexts.
    if (normalizedRole === 'ORG_MANAGER' || normalizedRole === 'SUPER_ADMIN') {
        return Object.entries(PERMISSIONS)
            .filter(([, roles]) => roles.includes('ADMIN'))
            .map(([permission]) => permission);
    }
    return [];
};

/**
 * Check a specific permission
 * Usage: hasPermission(req.user.role, 'CREATE_MOVEMENT')
 */
const hasPermission = (role, permission) => {
    const normalizedRole = normalizeRole(role);
    const resolvedPermission = resolvePermissionKey(permission);
    const allowedRoles = PERMISSIONS[resolvedPermission] || [];
    if (allowedRoles.includes(normalizedRole)) return true;
    if (normalizedRole === 'ORG_MANAGER' || normalizedRole === 'SUPER_ADMIN') {
        return allowedRoles.includes('ADMIN');
    }
    return false;
};

/**
 * Middleware: check specific permission key
 * Usage: requirePermission('MANAGE_MASTER_DATA')
 */
const requirePermission = (permission) => {
    return (req, res, next) => {
        if (!req.user || !hasPermission(req.user.role, permission)) {
            return res.status(403).json({
                success: false,
                message: `Access denied. Insufficient permissions.`,
                required: permission,
            });
        }
        next();
    };
};

module.exports = { authorize, hasPermission, requirePermission, PERMISSIONS, getPermissionsForRole };
