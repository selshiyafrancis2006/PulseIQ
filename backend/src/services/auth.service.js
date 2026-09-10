const bcrypt = require('bcryptjs');

const jwt = require('jsonwebtoken');

const pool = require('../config/db');

const JWT_SECRET = require('../config/jwt');

// Same defaults as the ones originally seeded globally in init.sql,
// now created per-user at signup time instead.
const DEFAULT_ALERT_RULES = [
    { metric_name: 'cpu_usage', operator: '>', threshold: 80, duration: 3 },
    { metric_name: 'memory_usage', operator: '>', threshold: 85, duration: 3 },
    { metric_name: 'disk_usage', operator: '>', threshold: 90, duration: 1 }
];

const register = async (email, password) => {

    const existing = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [email]
    );

    if (existing.rows.length > 0) {
        throw new Error('EMAIL_EXISTS');
    }

    const hashed =
        await bcrypt.hash(password, 10);

    const result = await pool.query(
        `
        INSERT INTO users (email, password)
        VALUES ($1, $2)
        RETURNING id, email
        `,
        [email, hashed]
    );

    const user = result.rows[0];

    for (const rule of DEFAULT_ALERT_RULES) {
        await pool.query(
            `INSERT INTO alert_rules (metric_name, operator, threshold, duration, user_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [rule.metric_name, rule.operator, rule.threshold, rule.duration, user.id]
        );
    }

    const token = jwt.sign(
        {
            id: user.id,
            email: user.email
        },
        JWT_SECRET,
        {
            expiresIn: '7d'
        }
    );

    return {
        token,
        email: user.email
    };

};

const login = async (email, password) => {

    const result = await pool.query(
        'SELECT * FROM users WHERE email = $1',
        [email]
    );

    if (result.rows.length === 0) {
        throw new Error('INVALID_CREDENTIALS');
    }

    const user = result.rows[0];

    const valid =
        await bcrypt.compare(password, user.password);

    if (!valid) {
        throw new Error('INVALID_CREDENTIALS');
    }

    const token = jwt.sign(
        {
            id: user.id,
            email: user.email
        },
        JWT_SECRET,
        {
            expiresIn: '7d'
        }
    );

    return {
        token,
        email: user.email
    };

};

module.exports = {
    register,
    login
};