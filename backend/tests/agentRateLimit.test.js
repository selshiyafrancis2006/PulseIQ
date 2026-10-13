
const express = require('express');
const request = require('supertest');
const rateLimit = require('express-rate-limit');

describe('Agent rate limiter', () => {
    let app;

    beforeEach(() => {
        app = express();

        const testRateLimit = rateLimit({
            windowMs: 60 * 1000,
            limit: 2,
            standardHeaders: 'draft-8',
            legacyHeaders: false,
            message: {
                error: 'Too many agent requests. Please retry later.'
            }
        });

        app.use(testRateLimit);
        app.get('/test', (req, res) => {
            res.status(200).json({ ok: true });
        });
    });

    test('allows requests within the limit', async () => {
        const first = await request(app).get('/test');
        const second = await request(app).get('/test');

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
    });

    test('rejects requests exceeding the limit', async () => {
        await request(app).get('/test');
        await request(app).get('/test');

        const third = await request(app).get('/test');

        expect(third.status).toBe(429);
        expect(third.body.error).toBe(
            'Too many agent requests. Please retry later.'
        );
    });
});
