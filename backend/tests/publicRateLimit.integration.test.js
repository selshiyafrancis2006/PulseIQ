const { app, pool, request } = require('./helpers');

afterAll(async () => {
    await pool.end();
});

const TOKEN = 'a'.repeat(64);

describe('public status page rate limit', () => {
    test('allows 120 requests per minute per IP, then answers 429', async () => {
        let lastAllowed;

        for (let i = 1; i <= 120; i += 1) {
            lastAllowed = await request(app).get('/api/public/status/no-such-page');
            expect(lastAllowed.status).not.toBe(429);
        }

        const blocked = await request(app).get('/api/public/status/no-such-page');

        expect(blocked.status).toBe(429);
        expect(blocked.body.message).toBe('Too many requests. Please retry later.');
    });
});

describe('heartbeat rate limit', () => {
    const beat = (monitorId) =>
        request(app)
            .post(`/api/heartbeat/${monitorId}`)
            .set('x-heartbeat-token', TOKEN);

    test('limits one monitor to 60 requests per minute without affecting others', async () => {
        for (let i = 1; i <= 60; i += 1) {
            expect((await beat(4001)).status).not.toBe(429);
        }

        const blocked = await beat(4001);

        expect(blocked.status).toBe(429);
        expect(blocked.body.message).toMatch(/Too many heartbeat requests for this monitor/);

        // A different monitor from the same IP has its own bucket.
        expect((await beat(4002)).status).not.toBe(429);
    });
});