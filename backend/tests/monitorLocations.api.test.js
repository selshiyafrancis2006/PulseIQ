const crypto = require('crypto');
const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

let monitorId;
let hostA;
let hostB;
let token;
let otherUserToken;
let otherUserHost;

async function createHost(userId, name) {
    const { rows } = await pool.query(
        `INSERT INTO hosts (name, api_key_hash, user_id)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [name, crypto.randomBytes(32).toString('hex'), userId]
    );

    return rows[0].id;
}

async function createHeartbeatMonitor(authToken) {
    const response = await request(app)
        .post('/api/monitors')
        .set(authHeader(authToken))
        .send({
            name: 'heartbeat-location-test',
            monitor_type: 'HEARTBEAT',
            interval_seconds: 60
        });
    expect(response.status).toBe(201);
    return response.body.id;
}
beforeEach(async () => {
    await resetDb();

    const user = await createUser();
    token = user.token;

    const otherUser = await createUser();
    otherUserToken = otherUser.token;

    const monitor = await request(app)
        .post('/api/monitors')
        .set(authHeader(token))
        .send({
            name: 'locations-api-test',
            url: 'https://example.com'
        });

    expect(monitor.status).toBe(201);
    monitorId = monitor.body.id;

    const { rows } = await pool.query(
        'SELECT user_id FROM monitors WHERE id = $1',
        [monitorId]
    );

    hostA = await createHost(rows[0].user_id, 'location-agent-a');
    hostB = await createHost(rows[0].user_id, 'location-agent-b');

    const otherUserId = await pool.query(
        'SELECT id FROM users ORDER BY id DESC LIMIT 1'
    );

    otherUserHost = await createHost(
        otherUserId.rows[0].id,
        'other-user-agent'
    );
});

afterAll(async () => {
    await pool.end();
});

test('assigns hosts and configures quorum', async () => {
    const response = await request(app)
        .put(`/api/monitors/${monitorId}/locations`)
        .set(authHeader(token))
        .send({
            host_ids: [hostA, hostB],
            quorum: 2
        });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
        monitor_id: monitorId,
        host_ids: [hostA, hostB],
        quorum: 2
    });

    const saved = await pool.query(
        `SELECT host_id FROM monitor_locations
         WHERE monitor_id = $1 ORDER BY host_id`,
        [monitorId]
    );

    expect(saved.rows.map(row => row.host_id).sort())
        .toEqual([hostA, hostB].sort());

    const monitor = await pool.query(
        'SELECT quorum FROM monitors WHERE id = $1',
        [monitorId]
    );

    expect(monitor.rows[0].quorum).toBe(2);
});

test('rejects assigning a host owned by another user', async () => {
    const response = await request(app)
        .put(`/api/monitors/${monitorId}/locations`)
        .set(authHeader(token))
        .send({
            host_ids: [hostA, otherUserHost],
            quorum: 1
        });

    expect(response.status).toBe(400);

    const saved = await pool.query(
        'SELECT host_id FROM monitor_locations WHERE monitor_id = $1',
        [monitorId]
    );

    expect(saved.rows).toHaveLength(0);
});

test('rejects a quorum greater than available locations', async () => {
    const response = await request(app)
        .put(`/api/monitors/${monitorId}/locations`)
        .set(authHeader(token))
        .send({
            host_ids: [hostA],
            quorum: 3
        });

    expect(response.status).toBe(400);
});

test('rejects duplicate host IDs', async () => {
    const response = await request(app)
        .put(`/api/monitors/${monitorId}/locations`)
        .set(authHeader(token))
        .send({
            host_ids: [hostA, hostA],
            quorum: 1
        });

    expect(response.status).toBe(400);
});

test('returns assigned locations and latest result', async () => {
    await request(app)
        .put(`/api/monitors/${monitorId}/locations`)
        .set(authHeader(token))
        .send({
            host_ids: [hostA],
            quorum: 1
        });

    await pool.query(
        `INSERT INTO monitor_location_results
            (monitor_id, host_id, status, response_time_ms)
         VALUES ($1, $2, 'UP', 42)`,
        [monitorId, hostA]
    );

    const response = await request(app)
        .get(`/api/monitors/${monitorId}/locations`)
        .set(authHeader(token));

    expect(response.status).toBe(200);
    expect(response.body.quorum).toBe(1);
    expect(response.body.locations).toHaveLength(1);
    expect(response.body.locations[0]).toMatchObject({
        host_id: hostA,
        host_name: 'location-agent-a',
        last_status: 'UP'
    });
});

test('does not expose another user's monitor locations', async () => {
    const response = await request(app)
        .get(`/api/monitors/${monitorId}/locations`)
        .set(authHeader(otherUserToken));

    expect(response.status).toBe(404);
});

test('agent monitor polling rejects a missing API key', async () => {
    const response = await request(app)
        .get('/api/agent/monitors');

    expect(response.status).toBe(401);
});

test('agent receives only its assigned active monitors', async () => {
    const crypto = require('crypto');

    const apiKey = crypto.randomBytes(32).toString('hex');
    const apiKeyHash = crypto
        .createHash('sha256')
        .update(apiKey)
        .digest('hex');

    await pool.query(
        'UPDATE hosts SET api_key_hash = $1 WHERE id = $2',
        [apiKeyHash, hostA]
    );

    await request(app)
        .put(`/api/monitors/${monitorId}/locations`)
        .set(authHeader(token))
        .send({
            host_ids: [hostA],
            quorum: 1
        });

    const inactiveMonitor = await request(app)
        .post('/api/monitors')
        .set(authHeader(token))
        .send({
            name: 'inactive-location-monitor',
            url: 'https://example.org'
        });

    expect(inactiveMonitor.status).toBe(201);

    await pool.query(
        'UPDATE monitors SET is_active = false WHERE id = $1',
        [inactiveMonitor.body.id]
    );

    await pool.query(
        `INSERT INTO monitor_locations (monitor_id, host_id)
         VALUES ($1, $2)`,
        [inactiveMonitor.body.id, hostA]
    );

    const response = await request(app)
        .get('/api/agent/monitors')
        .set('x-api-key', apiKey);

    expect(response.status).toBe(200);
    expect(response.body.monitors).toHaveLength(1);
    expect(response.body.monitors[0]).toMatchObject({
        id: monitorId,
        name: 'locations-api-test',
        monitor_type: 'HTTP'
    });
    expect(response.body.monitors.map(monitor => monitor.id))
        .not.toContain(inactiveMonitor.body.id);
});

test('rejects assigning hosts to a heartbeat monitor', async () => {
    const heartbeatMonitorId = await createHeartbeatMonitor(token);

    const response = await request(app)
        .put(`/api/monitors/${heartbeatMonitorId}/locations`)
        .set(authHeader(token))
        .send({
            host_ids: [hostA],
            quorum: 1
        });

    expect(response.status).toBe(400);
    expect(response.body.message)
        .toBe('Heartbeat monitors cannot use agent locations');

    const saved = await pool.query(
        `SELECT host_id FROM monitor_locations
         WHERE monitor_id = $1`,
        [heartbeatMonitorId]
    );

    expect(saved.rows).toHaveLength(0);
});

test('preserves existing assignments when heartbeat assignment is rejected', async () => {
    await request(app)
        .put(`/api/monitors/${monitorId}/locations`)
        .set(authHeader(token))
        .send({
            host_ids: [hostA],
            quorum: 1
        });

    await pool.query(
        `UPDATE monitors SET monitor_type = 'HEARTBEAT'
         WHERE id = $1`,
        [monitorId]
    );

    const response = await request(app)
        .put(`/api/monitors/${monitorId}/locations`)
        .set(authHeader(token))
        .send({
            host_ids: [hostB],
            quorum: 1
        });

    expect(response.status).toBe(400);

    const saved = await pool.query(
        `SELECT host_id FROM monitor_locations
         WHERE monitor_id = $1`,
        [monitorId]
    );

    expect(saved.rows.map(row => row.host_id)).toEqual([hostA]);
});
