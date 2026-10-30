const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

let owner;
let other;
let ownedMonitor;
let otherMonitor;

beforeAll(async () => {
    await resetDb();
    owner = await createUser();
    other = await createUser();

    const createMonitor = async (token, name) => {
        const res = await request(app)
            .post('/api/monitors')
            .set(authHeader(token))
            .send({ name, url: 'https://example.com' });

        expect(res.status).toBe(201);
        return res.body.id;
    };

    ownedMonitor = await createMonitor(owner.token, 'public-page-monitor');
    otherMonitor = await createMonitor(other.token, 'private-owner-monitor');

    await pool.query(
        `INSERT INTO monitor_results
            (monitor_id, status, response_time_ms, status_code, checked_at)
         VALUES ($1, 'UP', 145, 200, NOW())`,
        [ownedMonitor]
    );
});

afterAll(async () => {
    await pool.end();
});

test('creates a private page and does not expose it publicly', async () => {
    const saved = await request(app)
        .put('/api/status-pages')
        .set(authHeader(owner.token))
        .send({
            title: 'Production Status',
            description: 'Production services',
            monitor_ids: [ownedMonitor]
        });

    expect(saved.status).toBe(200);
    expect(saved.body.page.is_public).toBe(false);
    expect(saved.body.page.slug).toBeTruthy();

    const publicPage = await request(app)
        .get(`/api/public/status/${saved.body.page.slug}`);

    expect(publicPage.status).toBe(404);
});

test('publishes a page containing only the selected owned monitors', async () => {
    const saved = await request(app)
        .put('/api/status-pages')
        .set(authHeader(owner.token))
        .send({
            title: 'Production Status',
            description: 'All production checks',
            is_public: true,
            monitor_ids: [ownedMonitor]
        });

    expect(saved.status).toBe(200);
    expect(saved.body.page.is_public).toBe(true);

    const publicPage = await request(app)
        .get(`/api/public/status/${saved.body.page.slug}`);

    expect(publicPage.status).toBe(200);
    expect(publicPage.body.title).toBe('Production Status');
    expect(publicPage.body.overall_status).toBe('OPERATIONAL');
    expect(publicPage.body.monitors).toHaveLength(1);
    expect(publicPage.body.monitors[0]).toMatchObject({
        id: ownedMonitor,
        name: 'public-page-monitor',
        status: 'UP',
        response_time_ms: 145
    });
    expect(publicPage.body.monitors.some(m => m.id === otherMonitor)).toBe(false);
});

test('rejects attempts to publish another user's monitor', async () => {
    const saved = await request(app)
        .put('/api/status-pages')
        .set(authHeader(owner.token))
        .send({
            title: 'Invalid selection',
            is_public: true,
            monitor_ids: [ownedMonitor, otherMonitor]
        });

    expect(saved.status).toBe(400);
});

test('returns 404 for unknown public slugs', async () => {
    const res = await request(app)
        .get('/api/public/status/this-status-page-does-not-exist');

    expect(res.status).toBe(404);
});

test('returns the saved page configuration to its owner only', async () => {
    const saved = await request(app)
        .put('/api/status-pages')
        .set(authHeader(owner.token))
        .send({
            title: 'Configuration test',
            is_public: true,
            monitor_ids: [ownedMonitor]
        });

    expect(saved.status).toBe(200);

    const ownerConfig = await request(app)
        .get('/api/status-pages')
        .set(authHeader(owner.token));

    expect(ownerConfig.status).toBe(200);
    expect(ownerConfig.body.page.slug).toBe(saved.body.page.slug);
    expect(ownerConfig.body.monitor_ids).toContain(ownedMonitor);

    const otherConfig = await request(app)
        .get('/api/status-pages')
        .set(authHeader(other.token));

    expect(otherConfig.status).toBe(200);
    expect(otherConfig.body.page).toBeNull();
});

test('treats stale monitor results as UNKNOWN on public status pages', async () => {
    const saved = await request(app)
        .put('/api/status-pages')
        .set(authHeader(owner.token))
        .send({
            title: 'Stale result test',
            is_public: true,
            monitor_ids: [ownedMonitor]
        });

    expect(saved.status).toBe(200);

    const original = await pool.query(
        `SELECT checked_at FROM monitor_results
         WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT 1`,
        [ownedMonitor]
    );

    const originalCheckedAt = original.rows[0].checked_at;

    try {
        await pool.query(
            `UPDATE monitor_results
             SET checked_at = NOW() - INTERVAL '5 minutes'
             WHERE monitor_id = $1`,
            [ownedMonitor]
        );

        const publicPage = await request(app)
            .get(`/api/public/status/${saved.body.page.slug}`);

        expect(publicPage.status).toBe(200);
        expect(publicPage.body.overall_status).toBe('UNKNOWN');
        expect(publicPage.body.monitors).toHaveLength(1);
        expect(publicPage.body.monitors[0]).toMatchObject({
            id: ownedMonitor,
            status: 'UNKNOWN',
            response_time_ms: null
        });
        expect(publicPage.body.monitors[0].checked_at).not.toBeNull();
    } finally {
        await pool.query(
            `UPDATE monitor_results SET checked_at = $1
             WHERE monitor_id = $2`,
            [originalCheckedAt, ownedMonitor]
        );
    }
});
