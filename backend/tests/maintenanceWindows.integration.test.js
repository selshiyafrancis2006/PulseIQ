jest.mock('../src/services/httpCheck.service', () => ({
    checkHttp: jest.fn()
}));

const {
    app,
    pool,
    resetDb,
    createUser,
    authHeader,
    request
} = require('./helpers');

const { checkHttp } = require('../src/services/httpCheck.service');
const { checkMonitor } = require('../src/services/uptime.service');

beforeAll(async () => {
    await resetDb();
});

afterAll(async () => {
    await pool.end();
});

async function createMonitor(
    token,
    name = 'maintenance-test-monitor',
    failureThreshold = 3
) {
    const response = await request(app)
        .post('/api/monitors')
        .set(authHeader(token))
        .send({
            name,
            url: 'https://example.com',
            interval_seconds: 30,
            failure_threshold: failureThreshold
        });

    expect(response.status).toBe(201);
    return response.body;
}

async function createWindow(token, body) {
    return request(app)
        .post('/api/maintenance-windows')
        .set(authHeader(token))
        .send(body);
}

async function loadMonitorRow(id) {
    const result = await pool.query(
        'SELECT * FROM monitors WHERE id = $1',
        [id]
    );
    return result.rows[0];
}

test('creates a window from a duration and reports it as active', async () => {
    const user = await createUser();

    const response = await createWindow(user.token, {
        duration_minutes: 30,
        reason: 'Database upgrade'
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
        monitor_id: null,
        reason: 'Database upgrade',
        state: 'active'
    });
});

test('creates a monitor-scoped window with an explicit start in the future', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token);

    const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    const response = await createWindow(user.token, {
        monitor_id: monitor.id,
        starts_at: startsAt,
        ends_at: endsAt
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
        monitor_id: monitor.id,
        monitor_name: 'maintenance-test-monitor',
        state: 'upcoming'
    });
});

test('rejects invalid window requests', async () => {
    const user = await createUser();

    const neither = await createWindow(user.token, {});
    expect(neither.status).toBe(400);

    const both = await createWindow(user.token, {
        duration_minutes: 10,
        ends_at: new Date(Date.now() + 600000).toISOString()
    });
    expect(both.status).toBe(400);

    const badDuration = await createWindow(user.token, {
        duration_minutes: 0
    });
    expect(badDuration.status).toBe(400);

    const endsBeforeStart = await createWindow(user.token, {
        starts_at: new Date(Date.now() + 7200000).toISOString(),
        ends_at: new Date(Date.now() + 3600000).toISOString()
    });
    expect(endsBeforeStart.status).toBe(400);

    const alreadyOver = await createWindow(user.token, {
        starts_at: new Date(Date.now() - 7200000).toISOString(),
        ends_at: new Date(Date.now() - 3600000).toISOString()
    });
    expect(alreadyOver.status).toBe(400);
});

test('cannot create a window for another user\'s monitor', async () => {
    const owner = await createUser();
    const other = await createUser();
    const monitor = await createMonitor(owner.token);

    const response = await createWindow(other.token, {
        monitor_id: monitor.id,
        duration_minutes: 10
    });

    expect(response.status).toBe(404);
});

test('lists only the caller\'s windows and filters by state', async () => {
    const user = await createUser();
    const other = await createUser();

    await createWindow(user.token, { duration_minutes: 30 });
    await createWindow(user.token, {
        starts_at: new Date(Date.now() + 3600000).toISOString(),
        duration_minutes: 30
    });
    await createWindow(other.token, { duration_minutes: 30 });

    const all = await request(app)
        .get('/api/maintenance-windows')
        .set(authHeader(user.token));
    expect(all.status).toBe(200);
    expect(all.body).toHaveLength(2);

    const upcoming = await request(app)
        .get('/api/maintenance-windows?state=upcoming')
        .set(authHeader(user.token));
    expect(upcoming.body).toHaveLength(1);
    expect(upcoming.body[0].state).toBe('upcoming');

    const invalid = await request(app)
        .get('/api/maintenance-windows?state=nonsense')
        .set(authHeader(user.token));
    expect(invalid.status).toBe(400);
});

test('can end an active window early, but not an upcoming one', async () => {
    const user = await createUser();

    const active = await createWindow(user.token, { duration_minutes: 30 });
    const ended = await request(app)
        .post(`/api/maintenance-windows/${active.body.id}/end`)
        .set(authHeader(user.token));

    expect(ended.status).toBe(200);
    expect(ended.body.state).toBe('ended');

    const again = await request(app)
        .post(`/api/maintenance-windows/${active.body.id}/end`)
        .set(authHeader(user.token));
    expect(again.status).toBe(400);

    const upcoming = await createWindow(user.token, {
        starts_at: new Date(Date.now() + 3600000).toISOString(),
        duration_minutes: 30
    });
    const endUpcoming = await request(app)
        .post(`/api/maintenance-windows/${upcoming.body.id}/end`)
        .set(authHeader(user.token));
    expect(endUpcoming.status).toBe(400);
});

test('owner can delete a window; others get 404', async () => {
    const owner = await createUser();
    const other = await createUser();

    const created = await createWindow(owner.token, { duration_minutes: 30 });

    const forbidden = await request(app)
        .delete(`/api/maintenance-windows/${created.body.id}`)
        .set(authHeader(other.token));
    expect(forbidden.status).toBe(404);

    const deleted = await request(app)
        .delete(`/api/maintenance-windows/${created.body.id}`)
        .set(authHeader(owner.token));
    expect(deleted.status).toBe(200);
});

test('flags results during a window and records no events or alert state', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token);

    await createWindow(user.token, {
        monitor_id: monitor.id,
        duration_minutes: 30
    });

    checkHttp.mockResolvedValue({ statusCode: 503, responseTimeMs: 20 });

    await checkMonitor(await loadMonitorRow(monitor.id));

    const results = await pool.query(
        'SELECT status, in_maintenance FROM monitor_results WHERE monitor_id = $1',
        [monitor.id]
    );
    expect(results.rows).toEqual([
        { status: 'DOWN', in_maintenance: true }
    ]);

    const events = await pool.query(
        'SELECT 1 FROM monitor_events WHERE monitor_id = $1',
        [monitor.id]
    );
    expect(events.rowCount).toBe(0);

    const alertState = await pool.query(
        'SELECT 1 FROM monitor_alert_state WHERE monitor_id = $1',
        [monitor.id]
    );
    expect(alertState.rowCount).toBe(0);
});

test('a window for all monitors covers every monitor the user owns', async () => {
    const user = await createUser();
    const first = await createMonitor(user.token, 'first');
    const second = await createMonitor(user.token, 'second');

    await createWindow(user.token, { duration_minutes: 30 });

    checkHttp.mockResolvedValue({ statusCode: 200, responseTimeMs: 15 });

    await checkMonitor(await loadMonitorRow(first.id));
    await checkMonitor(await loadMonitorRow(second.id));

    const results = await pool.query(
        `SELECT monitor_id, in_maintenance
         FROM monitor_results
         WHERE monitor_id = ANY($1)
         ORDER BY monitor_id`,
        [[first.id, second.id]]
    );

    expect(results.rows.every((row) => row.in_maintenance)).toBe(true);
    expect(results.rowCount).toBe(2);
});

test('state changes are recorded again once the window has ended', async () => {
    const user = await createUser();
    const monitor = await createMonitor(
    user.token,
    'maintenance-test-monitor',
    1
);

    const created = await createWindow(user.token, {
        monitor_id: monitor.id,
        duration_minutes: 30
    });

    checkHttp.mockResolvedValue({ statusCode: 503, responseTimeMs: 20 });
    await checkMonitor(await loadMonitorRow(monitor.id));

    await request(app)
        .post(`/api/maintenance-windows/${created.body.id}/end`)
        .set(authHeader(user.token))
        .expect(200);

    await checkMonitor(await loadMonitorRow(monitor.id));

    const results = await pool.query(
        `SELECT in_maintenance FROM monitor_results
         WHERE monitor_id = $1 ORDER BY checked_at`,
        [monitor.id]
    );
    expect(results.rows.map((row) => row.in_maintenance)).toEqual([
        true,
        false
    ]);

    const events = await pool.query(
        'SELECT type FROM monitor_events WHERE monitor_id = $1',
        [monitor.id]
    );
    expect(events.rows).toEqual([{ type: 'DOWN' }]);
});