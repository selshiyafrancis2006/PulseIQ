const pool = require('../config/db');
const { hashApiKey } = require('../utils/apiKey');

const authenticateAgent = async (req, res, next) => {

    try {

        const apiKey = req.headers['x-api-key'];

        if (!apiKey || typeof apiKey !== 'string') {
            return res.status(401).json({
                error: 'Missing API key'
            });
        }

        // Find the host by the key's hash and mark it active in one query
        const result = await pool.query(
            `UPDATE hosts
             SET last_seen_at = NOW()
             WHERE api_key_hash = $1
             RETURNING id, name`,
            [hashApiKey(apiKey)]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                error: 'Invalid API key'
            });
        }

        req.agentHost = result.rows[0];

        next();

    } catch (err) {

        console.error('Agent auth error:', err);

        return res.status(500).json({
            error: 'Authentication failed'
        });

    }

};

module.exports = authenticateAgent;