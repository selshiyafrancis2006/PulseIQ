
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

async function insertResultAt(monitorId, status, checkedAt) {
    await pool.query(
        `INSERT INTO monitor_results
            (monitor_id, status, response_time_ms, status_code, checked_at)
         VALUES ($1, $2, 100, 200, $3)`,
        [monitorId, status, checkedAt]
    );
}

async function insertResultHoursAgo(monitorId, status, hoursAgo) {
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

async function insertEvent(monitorId, type, minutesAgo) {
    await pool.query(
        `INSERT INTO monitor_events
            (monitor_id, type, message, created_at)
         VALUES (
            $1, $2, $3,
            NOW() - ($4 * INTERVAL '1 minute')
         )`,
        [
            monitorId,
            type,
            type === 'DOWN' ? 'Monitor went down' : 'Monitor recovered',
            minutesAgo
        ]
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

test('uptime reports incomplete coverage when monitoring has a long gap', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token, 'uptime-monitoring-gap');

    await pool.query(
    `UPDATE monitors
     SET created_at = NOW() - INTERVAL '24 hours'
     WHERE id = $1`,
    [monitor.id]
);

    const now = Date.now();

    await insertResultAt(
        monitor.id,
        'DOWN',
        new Date(now - 20 * 60 * 60 * 1000)
    );
    await insertResultAt(monitor.id, 'UP', new Date(now));

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/uptime`)
        .query({ range: '24h' })
        .set(authHeader(user.token));

    expect(response.status).toBe(200);
    expect(response.body.uptime).toBe(50);
    expect(response.body.coverage).toBe('insufficient_data');
});

test('uptime ignores a long gap before the selected window', async () => {
    const user = await createUser();
    const monitor = await createMonitor(
        user.token,
        'uptime-pre-window-gap'
    );

    await pool.query(
        `UPDATE monitors
         SET created_at = NOW() - INTERVAL '48 hours',
             interval_seconds = 3600
         WHERE id = $1`,
        [monitor.id]
    );

    const now = Date.now();

    // This check is outside the 24-hour window.
    await insertResultAt(
        monitor.id,
        'UP',
        new Date(now - 30 * 60 * 60 * 1000)
    );

    // Regular hourly checks inside the selected window.
    for (let hoursAgo = 23; hoursAgo >= 1; hoursAgo--) {
        await insertResultAt(
            monitor.id,
            'UP',
            new Date(now - hoursAgo * 60 * 60 * 1000)
        );
    }

    // Recent check keeps the monitor from appearing stale.
    await insertResultAt(
        monitor.id,
        'UP',
        new Date(now - 60 * 1000)
    );

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/uptime`)
        .query({ range: '24h' })
        .set(authHeader(user.token));

    expect(response.status).toBe(200);
    expect(response.body.uptime).toBe(100);
    expect(response.body.coverage).toBe('complete');
});

test('uptime detects an initial gap even when a historical check exists', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token, 'uptime-initial-gap');

    await pool.query(
        `UPDATE monitors
         SET created_at = NOW() - INTERVAL '48 hours'
         WHERE id = $1`,
        [monitor.id]
    );

    const now = Date.now();

    await insertResultAt(
        monitor.id,
        'UP',
        new Date(now - 26 * 60 * 60 * 1000)
    );
    await insertResultAt(
        monitor.id,
        'UP',
        new Date(now - 20 * 60 * 60 * 1000)
    );
    await insertResultAt(
        monitor.id,
        'UP',
        new Date(now)
    );

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/uptime`)
        .query({ range: '24h' })
        .set(authHeader(user.token));

    expect(response.status).toBe(200);
    expect(response.body.coverage).toBe('insufficient_data');
});

test('SLO reports insufficient data when monitoring has a long gap', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token, 'slo-monitoring-gap');

    const now = Date.now();

    await insertResultAt(
        monitor.id,
        'DOWN',
        new Date(now - 20 * 60 * 60 * 1000)
    );
    await insertResultAt(monitor.id, 'UP', new Date(now));

    await insertEvent(monitor.id, 'DOWN', 20 * 60);
    await insertEvent(monitor.id, 'UP', 1);

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/uptime`)
        .query({ range: '30d' })
        .set(authHeader(user.token));

    expect(response.status).toBe(200);
    expect(response.body.slo.status).toBe('insufficient_data');
    expect(response.body.slo.observed_downtime_minutes).toBeNull();
    expect(response.body.slo.remaining_budget_minutes).toBeNull();
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
