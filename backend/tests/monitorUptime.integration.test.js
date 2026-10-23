
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

async function insertResult(monitorId, status, hoursAgo = 1) {
    await pool.query(
        `INSERT INTO monitor_results
            (monitor_id, status, response_time_ms, status_code, checked_at)
         VALUES (
            $1, $2, 100, 200,
            NOW() - ($3 * INTERVAL '1 hour')
         )`,
        [monitorId, status, hoursAgo]
    );
}

test.each([
    ['24h', 24],
    ['7d', 168],
    ['30d', 720]
])('uptime accepts the %s range', async (range) => {
    const user = await createUser();
    const monitor = await createMonitor(user.token, `range-${range}`);

    await insertResult(monitor.id, 'UP');

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/uptime`)
        .query({ range })
        .set(authHeader(user.token));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
        range,
        total_checks: 1,
        up_checks: 1,
        uptime: 100
    });
});

test('uptime calculates the percentage of successful checks', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token, 'mixed-uptime');

    await insertResult(monitor.id, 'UP', 1);
    await insertResult(monitor.id, 'UP', 2);
    await insertResult(monitor.id, 'DOWN', 3);
    await insertResult(monitor.id, 'DOWN', 4);

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/uptime`)
        .set(authHeader(user.token));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
        range: '24h',
        total_checks: 4,
        up_checks: 2,
        uptime: 50
    });
});

test('uptime excludes checks older than the selected range', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token, 'uptime-cutoff-test');

    await insertResult(monitor.id, 'UP', 0);
    await insertResult(monitor.id, 'UP', 1);
    await insertResult(monitor.id, 'DOWN', 2);
    await insertResult(monitor.id, 'DOWN', 48);

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/uptime`)
        .query({ range: '24h' })
        .set(authHeader(user.token));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
        range: '24h',
        total_checks: 3,
        up_checks: 2,
        uptime: 66.67
    });
});

test('uptime returns null when no checks exist', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token, 'empty-uptime');

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/uptime`)
        .set(authHeader(user.token));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
        range: '24h',
        total_checks: 0,
        up_checks: 0,
        uptime: null
    });
});

test('uptime rejects an unsupported range', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token, 'invalid-range');

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/uptime`)
        .query({ range: '90d' })
        .set(authHeader(user.token));

    expect(response.status).toBe(400);
});

test('uptime rejects an invalid monitor ID', async () => {
    const user = await createUser();

    const response = await request(app)
        .get('/api/monitors/not-a-number/uptime')
        .set(authHeader(user.token));

    expect(response.status).toBe(400);
});

test('uptime does not expose another user’s monitor', async () => {
    const owner = await createUser();
    const otherUser = await createUser();
    const monitor = await createMonitor(owner.token, 'private-uptime');

    await insertResult(monitor.id, 'UP');

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/uptime`)
        .set(authHeader(otherUser.token));

    expect(response.status).toBe(404);
});
