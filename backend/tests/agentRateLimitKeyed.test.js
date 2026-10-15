const express = require('express');
const request = require('supertest');
const agentRateLimit = require('../src/middleware/agentRateLimit.middleware');

describe('Agent rate limiter (real middleware, per API key)', () => {
    const app = express();

    app.use('/api/agent', agentRateLimit, (req, res) => {
        res.status(200).json({ ok: true });
    });

    const hit = (key) =>
        request(app).get('/api/agent/ping').set('x-api-key', key);

    test('one key is limited without throttling another key on the same IP', async () => {
        for (let i = 0; i < 120; i++) {
            const response = await hit('key-a');
            expect(response.status).toBe(200);
        }

        const blocked = await hit('key-a');
        expect(blocked.status).toBe(429);
        expect(blocked.body.error).toBe(
            'Too many agent requests. Please retry later.'
        );

        const otherKey = await hit('key-b');
        expect(otherKey.status).toBe(200);
    });
});