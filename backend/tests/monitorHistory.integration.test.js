
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

test('monitor history returns detailed timing metrics for its owner', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token, 'history-timing-test');

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
    const monitor = await createMonitor(owner.token, 'private-history-test');

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
