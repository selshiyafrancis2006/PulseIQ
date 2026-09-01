const pool = require('../config/db');

const authenticateAgent = async (req, res, next) => {

    try {

        const apiKey = req.headers['x-api-key'];

        if (!apiKey) {
            return res.status(401).json({
                error: 'Missing API key'
            });
        }

        const result = await pool.query(
            'SELECT id, name FROM hosts WHERE api_key = $1',
            [apiKey]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                error: 'Invalid API key'
            });
        }

        const host = result.rows[0];

        // Update last_seen_at so we know this host is active
        await pool.query(
            'UPDATE hosts SET last_seen_at = NOW() WHERE id = $1',
            [host.id]
        );

        req.agentHost = host;

        next();

    } catch (err) {

        console.error('Agent auth error:', err);

        return res.status(500).json({
            error: 'Authentication failed'
        });

    }

};

module.exports = authenticateAgent;