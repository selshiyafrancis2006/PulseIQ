function requireAdmin(req, res, next) {
    const adminIds = (process.env.PULSEIQ_ADMIN_USER_IDS || '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);

    const userId = req.user?.id;

    if (!userId || !adminIds.includes(String(userId))) {
        return res.status(403).json({
            error: 'Forbidden'
        });
    }

    return next();
}

module.exports = requireAdmin;
