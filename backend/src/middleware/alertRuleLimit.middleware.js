const pool = require('../config/db');

// Every active rule is evaluated on every incoming sample, so an unbounded
// number of rules per user would slow ingestion for everyone.
const MAX_RULES_PER_USER = 100;

async function enforceAlertRuleLimit(req, res, next) {
    try {
        const result = await pool.query(
            'SELECT COUNT(*)::int AS count FROM alert_rules WHERE user_id = $1',
            [req.user.id]
        );

        if (result.rows[0].count >= MAX_RULES_PER_USER) {
            return res.status(409).json({
                error: `Alert rule limit reached (${MAX_RULES_PER_USER}). Delete a rule before adding another.`
            });
        }

        return next();
    } catch (err) {
        console.error('Failed to check alert rule limit:', err);
        return res.status(500).json({ error: 'Failed to create alert rule' });
    }
}

module.exports = { enforceAlertRuleLimit, MAX_RULES_PER_USER };