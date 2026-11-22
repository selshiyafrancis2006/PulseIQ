const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

describe('GET /api/metrics/rollup-health', () => {
    let user;
    let regularUser;
    let previousAdminIds;

    beforeAll(async () => {
        await resetDb();
        user = await createUser();
        regularUser = await createUser();

        // The route is admin-only. Set the admin list here so the test does
        // not depend on a developer's local .env (CI has none).
        previousAdminIds = process.env.PULSEIQ_ADMIN_USER_IDS;

        const admin = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [user.email]
        );

        process.env.PULSEIQ_ADMIN_USER_IDS = String(admin.rows[0].id);
    });

    afterAll(async () => {
        if (previousAdminIds === undefined) {
            delete process.env.PULSEIQ_ADMIN_USER_IDS;
        } else {
            process.env.PULSEIQ_ADMIN_USER_IDS = previousAdminIds;
        }

        await pool.end();
    });

    test('rejects a logged-in user who is not an admin', async () => {
        const res = await request(app)
            .get('/api/metrics/rollup-health')
            .set(authHeader(regularUser.token));

        expect(res.status).toBe(403);
    });

    test('rejects requests without authentication', async () => {
        const res = await request(app)
            .get('/api/metrics/rollup-health');

        expect(res.status).toBe(401);
    });

    test('returns the health state of both metric rollup jobs', async () => {
        const res = await request(app)
            .get('/api/metrics/rollup-health')
            .set(authHeader(user.token));

        expect(res.status).toBe(200);
        expect(res.body).toEqual(expect.objectContaining({
            checkedAt: expect.any(String),
            jobs: expect.objectContaining({
                '5m': expect.objectContaining({
                    lastSuccessAt: null,
                    lastFailureAt: null,
                    lastError: null,
                    consecutiveFailures: 0
                }),
                '1h': expect.objectContaining({
                    lastSuccessAt: null,
                    lastFailureAt: null,
                    lastError: null,
                    consecutiveFailures: 0
                })
            })
        }));

        expect(Number.isNaN(Date.parse(res.body.checkedAt))).toBe(false);
    });
        test('also reports the daily cleanup job', async () => {
        const res = await request(app)
            .get('/api/metrics/rollup-health')
            .set(authHeader(user.token));

        expect(res.body.jobs.cleanup).toEqual(expect.objectContaining({
            staleAfterSeconds: 26 * 60 * 60,
            consecutiveFailures: 0
        }));
    });
});
