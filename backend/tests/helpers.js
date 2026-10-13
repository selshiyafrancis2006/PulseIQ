const request = require('supertest');
const pool = require('../src/config/db');
const { app } = require('../src/app');

let counter = 0;

async function resetDb() {
    await pool.query(
        'TRUNCATE users, metrics, logs, traces RESTART IDENTITY CASCADE'
    );
}

// Registers a fresh user through the real API and returns its token
async function createUser(email) {
    counter += 1;
    const address = email || `user${counter}-${Date.now()}@test.dev`;

    const res = await request(app)
        .post('/api/auth/register')
        .send({ email: address, password: 'password123' });

    if (res.status !== 200) {
        throw new Error(`createUser failed: ${res.status} ${JSON.stringify(res.body)}`);
    }

    return { email: address, token: res.body.token };
}

const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

module.exports = { app, pool, request, resetDb, createUser, authHeader };