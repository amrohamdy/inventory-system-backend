/**
 * SaaS Phase 1 — Super Admin Guard
 * Blocks access unless req.user.role === 'SUPER_ADMIN'
 */
const requireSuperAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    if (req.user.role !== 'SUPER_ADMIN') {
        return res.status(403).json({
            success: false,
            message: 'Access denied. SUPER_ADMIN role required.',
            code: 'SUPER_ADMIN_REQUIRED',
        });
    }
    next();
};

module.exports = { requireSuperAdmin };
