const bcrypt = require('bcryptjs');

const jwt = require('jsonwebtoken');

const pool = require('../config/db');

const JWT_SECRET =
    process.env.JWT_SECRET || 'pulseiq_secret_key';

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