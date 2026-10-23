const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

beforeAll(async () => {
    await resetDb();
});

afterAll(async () => {
    await pool.end();
});

async function createMonitor(token, name) {
    const response = await request(app)
        .post('/api/monitors')
        .set(authHeader(token))
        .send({
            name,
            url: 'https://example.com'
        });

    expect(response.status).toBe(201);
    return response.body;
}

test('monitor creation defaults interval_seconds to 30', async () => {
    const user = await createUser();

    const response = await request(app)
        .post('/api/monitors')
        .set(authHeader(user.token))
        .send({
            name: 'default-interval-test',
            url: 'https://example.com'
        });

    expect(response.status).toBe(201);
    expect(response.body.interval_seconds).toBe(30);
});

test('monitor creation accepts a valid custom interval', async () => {
    const user = await createUser();

    const response = await request(app)
        .post('/api/monitors')
        .set(authHeader(user.token))
        .send({
            name: 'custom-interval-test',
            url: 'https://example.com',
            interval_seconds: 60
        });

    expect(response.status).toBe(201);
    expect(response.body.interval_seconds).toBe(60);
});

test('monitor creation rejects an invalid interval', async () => {
    const user = await createUser();

    const response = await request(app)
        .post('/api/monitors')
        .set(authHeader(user.token))
        .send({
            name: 'invalid-interval-test',
            url: 'https://example.com',
            interval_seconds: 10
        });

    expect(response.status).toBe(400);
});

test('monitor history returns detailed timing metrics for its owner', async () => {
    const user = await createUser();
    const monitor = await createMonitor(
        user.token,
        'history-timing-test'
    );

    const timings = {
        dns_time_ms: 12.5,
        connect_time_ms: 24.5,
        tls_time_ms: 35.5,
        ttfb_time_ms: 48.5,
        download_time_ms: 6.5
    };

    await pool.query(
        `INSERT INTO monitor_results
            (monitor_id, status, response_time_ms, status_code,
             dns_time_ms, connect_time_ms, tls_time_ms,
             ttfb_time_ms, download_time_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
            monitor.id,
            'UP',
            130,
            200,
            timings.dns_time_ms,
            timings.connect_time_ms,
            timings.tls_time_ms,
            timings.ttfb_time_ms,
            timings.download_time_ms
        ]
    );

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/history`)
        .set(authHeader(user.token));

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);

    const result = response.body[0];

    expect(result).toMatchObject({
        status: 'UP',
        response_time_ms: 130,
        status_code: 200,
        ...timings
    });

    expect(result).toHaveProperty('checked_at');
});

test('monitor history does not expose another user’s results', async () => {
    const owner = await createUser();
    const otherUser = await createUser();

    const monitor = await createMonitor(
        owner.token,
        'private-history-test'
    );

    await pool.query(
        `INSERT INTO monitor_results
            (monitor_id, status, response_time_ms, status_code)
         VALUES ($1, 'UP', 100, 200)`,
        [monitor.id]
    );

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/history`)
        .set(authHeader(otherUser.token));

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
});
test.each([
    ['24h', 24],
    ['7d', 168],
    ['30d', 720]
])('monitor history accepts the %s range', async (range) => {
    const user = await createUser();
    const monitor = await createMonitor(
        user.token,
        `history-range-${range}`
    );

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/history?range=${range}`)
        .set(authHeader(user.token));

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
});

test('monitor history rejects an unsupported range', async () => {
    const user = await createUser();
    const monitor = await createMonitor(
        user.token,
        'history-invalid-range'
    );

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/history?range=90d`)
        .set(authHeader(user.token));

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Invalid range/i);
});

test('monitor history rejects an invalid monitor ID', async () => {
    const user = await createUser();

    const response = await request(app)
        .get('/api/monitors/invalid/history')
        .set(authHeader(user.token));

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Invalid monitor ID/i);
});

test('24h monitor history excludes results older than 24 hours', async () => {
    const user = await createUser();
    const monitor = await createMonitor(
        user.token,
        'history-cutoff-test'
    );

    await pool.query(
        `INSERT INTO monitor_results
            (monitor_id, status, response_time_ms, status_code, checked_at)
         VALUES
            ($1, 'UP', 100, 200, NOW()),
            ($1, 'DOWN', NULL, NULL, NOW() - INTERVAL '48 hours')`,
        [monitor.id]
    );

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/history?range=24h`)
        .set(authHeader(user.token));

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].status).toBe('UP');
});

test('monitor history caps sampled results and preserves DOWN checks', async () => {
    const user = await createUser();
    const monitor = await createMonitor(
        user.token,
        'history-sampling-test'
    );

    await pool.query(
        `INSERT INTO monitor_results
            (monitor_id, status, response_time_ms, status_code, checked_at)
         SELECT
            $1,
            CASE WHEN n % 10 = 0 THEN 'DOWN' ELSE 'UP' END,
            CASE WHEN n % 10 = 0 THEN NULL ELSE 100 END,
            CASE WHEN n % 10 = 0 THEN NULL ELSE 200 END,
            NOW() - (n * INTERVAL '5 seconds')
        FROM generate_series(1, 600) AS n`,
        [monitor.id]
    );

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/history?range=24h`)
        .set(authHeader(user.token));

    expect(response.status).toBe(200);
    expect(response.body.length).toBeLessThanOrEqual(200);
    expect(response.body.some(result => result.status === 'DOWN')).toBe(true);
});

test('monitor events rejects an invalid monitor ID', async () => {
    const user = await createUser();

    const response = await request(app)
        .get('/api/monitors/not-a-number/events')
        .set(authHeader(user.token));

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Invalid monitor ID/i);
});
