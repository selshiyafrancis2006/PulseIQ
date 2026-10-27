
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

await pool.query(
    `INSERT INTO monitor_events
        (monitor_id, type, message, created_at)
     SELECT
        id,
        'UP',
        'Monitor available at monitoring start',
        created_at
     FROM monitors
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

test('uptime reports insufficient coverage when the latest check is stale', async () => {
    const user = await createUser();
    const monitor = await createMonitor(
        user.token,
        'uptime-stale-check'
    );

    await pool.query(
        `UPDATE monitors
         SET created_at = NOW() - INTERVAL '48 hours',
             interval_seconds = 3600
         WHERE id = $1`,
        [monitor.id]
    );

    // The latest check is older than three configured intervals.
    await insertResultAt(
        monitor.id,
        'UP',
        new Date(Date.now() - 5 * 60 * 60 * 1000)
    );

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/uptime`)
        .query({ range: '24h' })
        .set(authHeader(user.token));

    expect(response.status).toBe(200);
    expect(response.body.uptime).toBe(100);
    expect(response.body.coverage).toBe('insufficient_data');
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


test('uptime excludes checks recorded during maintenance', async () => {
    const user = await createUser();
    const monitor = await createMonitor(
        user.token,
        'uptime-maintenance-exclusion'
    );

    await pool.query(
        `INSERT INTO monitor_results
            (monitor_id, status, response_time_ms, status_code,
             checked_at, in_maintenance)
         VALUES
            ($1, 'UP', 100, 200, NOW() - INTERVAL '1 hour', false),
            ($1, 'DOWN', NULL, NULL, NOW() - INTERVAL '30 minutes', true),
            ($1, 'DOWN', NULL, NULL, NOW() - INTERVAL '15 minutes', true)`,
        [monitor.id]
    );

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/uptime`)
        .query({ range: '24h' })
        .set(authHeader(user.token));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
        range: '24h',
        total_checks: 1,
        up_checks: 1,
        uptime: 100
    });
});


test('coverage does not become stale during active maintenance', async () => {
    const user = await createUser();
    const monitor = await createMonitor(
        user.token,
        'uptime-active-maintenance'
    );

    await pool.query(
        `UPDATE monitors
         SET created_at = NOW() - INTERVAL '48 hours',
             interval_seconds = 3600
         WHERE id = $1`,
        [monitor.id]
    );

    // Simulate regular hourly checks, with the latest 5 hours ago.
    for (let hoursAgo = 23; hoursAgo >= 5; hoursAgo--) {
        await insertResultHoursAgo(monitor.id, 'UP', hoursAgo);
    }

    const userResult = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [user.email]
    );
    const userId = userResult.rows[0].id;

    // Maintenance started 4 hours ago and is still active.
    await pool.query(
        `INSERT INTO maintenance_windows
            (user_id, monitor_id, reason, starts_at, ends_at)
         VALUES (
            $1, $2, 'Planned maintenance',
            NOW() - INTERVAL '4 hours',
            NOW() + INTERVAL '1 hour'
         )`,
        [userId, monitor.id]
    );

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/uptime`)
        .query({ range: '24h' })
        .set(authHeader(user.token));

    expect(response.status).toBe(200);
    expect(response.body.coverage).toBe('complete');
});


test('coverage ignores a long gap covered by maintenance', async () => {
    const user = await createUser();
    const monitor = await createMonitor(
        user.token,
        'uptime-maintenance-gap'
    );

    await pool.query(
        `UPDATE monitors
         SET created_at = NOW() - INTERVAL '48 hours',
             interval_seconds = 3600
         WHERE id = $1`,
        [monitor.id]
    );

    // Regular hourly checks before the maintenance gap.
    for (let hoursAgo = 23; hoursAgo >= 12; hoursAgo--) {
        await insertResultHoursAgo(monitor.id, 'UP', hoursAgo);
    }

    // Checks resume after maintenance ends.
    for (let hoursAgo = 2; hoursAgo >= 0; hoursAgo--) {
        await insertResultHoursAgo(monitor.id, 'UP', hoursAgo);
    }

    const userResult = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [user.email]
    );
    const userId = userResult.rows[0].id;

    // The 10-hour gap is covered by 8 hours of planned maintenance.
    await pool.query(
        `INSERT INTO maintenance_windows
            (user_id, monitor_id, reason, starts_at, ends_at)
         VALUES (
            $1, $2, 'Planned maintenance',
            NOW() - INTERVAL '11 hours',
            NOW() - INTERVAL '3 hours'
         )`,
        [userId, monitor.id]
    );

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/uptime`)
        .query({ range: '24h' })
        .set(authHeader(user.token));

    expect(response.status).toBe(200);
    expect(response.body.coverage).toBe('complete');
});

test('coverage does not double-count overlapping maintenance windows', async () => {
    const user = await createUser();
    const monitor = await createMonitor(
        user.token,
        'uptime-overlapping-maintenance'
    );

    await pool.query(
        `UPDATE monitors
         SET created_at = NOW() - INTERVAL '48 hours',
             interval_seconds = 3600
         WHERE id = $1`,
        [monitor.id]
    );

    // Regular checks before the 10-hour gap.
    for (let hoursAgo = 23; hoursAgo >= 12; hoursAgo--) {
        await insertResultHoursAgo(monitor.id, 'UP', hoursAgo);
    }

    // Checks resume after the gap.
    for (let hoursAgo = 2; hoursAgo >= 0; hoursAgo--) {
        await insertResultHoursAgo(monitor.id, 'UP', hoursAgo);
    }

    const userResult = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [user.email]
    );
    const userId = userResult.rows[0].id;

    // These windows overlap by 2 hours.
    // Their combined coverage is 6 hours, not 8 hours.
    await pool.query(
        `INSERT INTO maintenance_windows
            (user_id, monitor_id, reason, starts_at, ends_at)
         VALUES
            ($1, $2, 'Maintenance window A',
             NOW() - INTERVAL '11 hours',
             NOW() - INTERVAL '7 hours'),
            ($1, $2, 'Maintenance window B',
             NOW() - INTERVAL '9 hours',
             NOW() - INTERVAL '5 hours')`,
        [userId, monitor.id]
    );

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/uptime`)
        .query({ range: '24h' })
        .set(authHeader(user.token));

    expect(response.status).toBe(200);
    expect(response.body.coverage).toBe('insufficient_data');
});

test('coverage accounts for maintenance at the start of the selected range', async () => {
    const user = await createUser();
    const monitor = await createMonitor(
        user.token,
        'uptime-initial-maintenance'
    );

    await pool.query(
        `UPDATE monitors
         SET created_at = NOW() - INTERVAL '48 hours',
             interval_seconds = 3600
         WHERE id = $1`,
        [monitor.id]
    );

    await pool.query(
    `INSERT INTO monitor_events
        (monitor_id, type, message, created_at)
     SELECT id, 'UP', 'Monitor available at monitoring start', created_at
     FROM monitors
     WHERE id = $1`,
    [monitor.id]
);

    // The first check is 20 hours ago, leaving a 4-hour initial gap
    // in the selected 24-hour range.
    for (let hoursAgo = 20; hoursAgo >= 0; hoursAgo--) {
        await insertResultHoursAgo(monitor.id, 'UP', hoursAgo);
    }

    const userResult = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [user.email]
    );
    const userId = userResult.rows[0].id;

    // Two hours of the initial gap are covered by maintenance.
    // The remaining uncovered gap is 2 hours, below the 3-hour threshold.
    await pool.query(
        `INSERT INTO maintenance_windows
            (user_id, monitor_id, reason, starts_at, ends_at)
         VALUES (
            $1, $2, 'Initial planned maintenance',
            NOW() - INTERVAL '24 hours',
            NOW() - INTERVAL '22 hours'
         )`,
        [userId, monitor.id]
    );

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/uptime`)
        .query({ range: '24h' })
        .set(authHeader(user.token));

    expect(response.status).toBe(200);
    expect(response.body.coverage).toBe('complete');
});


test('SLO coverage accounts for maintenance-covered gaps', async () => {
    const user = await createUser();
    const monitor = await createMonitor(
        user.token,
        'slo-maintenance-gap'
    );

    await pool.query(
        `UPDATE monitors
         SET created_at = NOW() - INTERVAL '48 hours',
             interval_seconds = 3600
         WHERE id = $1`,
        [monitor.id]
    );

    await pool.query(
    `INSERT INTO monitor_events
        (monitor_id, type, message, created_at)
     SELECT
        id,
        'UP',
        'Monitor available at monitoring start',
        created_at
     FROM monitors
     WHERE id = $1`,
    [monitor.id]
);

    // Regular hourly checks before the gap.
    for (let hoursAgo = 47; hoursAgo >= 12; hoursAgo--) {
        await insertResultHoursAgo(monitor.id, 'UP', hoursAgo);
    }

    // Checks resume after the gap.
    for (let hoursAgo = 2; hoursAgo >= 0; hoursAgo--) {
        await insertResultHoursAgo(monitor.id, 'UP', hoursAgo);
    }

    const userResult = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [user.email]
    );
    const userId = userResult.rows[0].id;

    // The gap between checks is 10 hours.
    // These overlapping windows cover 8 hours in total,
    // leaving only 2 uncovered hours (below the 3-hour threshold).
    await pool.query(
        `INSERT INTO maintenance_windows
            (user_id, monitor_id, reason, starts_at, ends_at)
         VALUES
            ($1, $2, 'Maintenance A',
             NOW() - INTERVAL '11 hours',
             NOW() - INTERVAL '7 hours'),
            ($1, $2, 'Maintenance B',
             NOW() - INTERVAL '9 hours',
             NOW() - INTERVAL '3 hours')`,
        [userId, monitor.id]
    );

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}/uptime`)
        .query({ range: '30d' })
        .set(authHeader(user.token));

expect(response.status).toBe(200);
expect(response.body.slo.status).not.toBe('insufficient_data');
});
