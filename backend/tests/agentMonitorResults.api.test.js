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
let keyA;
let keyB;
let ownerId;

function newKey() {
    const apiKey = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
    return { apiKey, hash };
}

async function createHost(userId, name, hash) {
    const { rows } = await pool.query(
        `INSERT INTO hosts (name, api_key_hash, user_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [name, hash, userId]
    );
    return rows[0].id;
}

const post = (key, body) =>
    request(app)
        .post('/api/agent/monitor-results')
        .set('x-api-key', key)
        .send(body);

beforeEach(async () => {
    await resetDb();

    const { token } = await createUser();

    const monitor = await request(app)
        .post('/api/monitors')
        .set(authHeader(token))
        .send({ name: 'ingest-test', url: 'https://example.com' });

    expect(monitor.status).toBe(201);
    monitorId = monitor.body.id;

    const owner = await pool.query(
        'SELECT user_id FROM monitors WHERE id = $1',
        [monitorId]
    );
    ownerId = owner.rows[0].user_id;

    const a = newKey();
    const b = newKey();
    keyA = a.apiKey;
    keyB = b.apiKey;

    hostA = await createHost(ownerId, 'ingest-agent-a', a.hash);
    hostB = await createHost(ownerId, 'ingest-agent-b', b.hash);

    // Only host A is assigned to the monitor.
    await pool.query(
        'INSERT INTO monitor_locations (monitor_id, host_id) VALUES ($1, $2)',
        [monitorId, hostA]
    );
});

afterAll(async () => {
    await pool.end();
});

test('rejects a missing API key', async () => {
    const res = await request(app)
        .post('/api/agent/monitor-results')
        .send({ monitor_id: monitorId, status: 'UP' });

    expect(res.status).toBe(401);
});

test('stores a result from an assigned agent', async () => {
    const res = await post(keyA, {
        monitor_id: monitorId,
        status: 'DOWN',
        response_time_ms: 1200,
        status_code: 503,
        error_type: 'HTTP_STATUS',
        error_message: 'Unexpected status 503'
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
        monitor_id: monitorId,
        host_id: hostA,
        status: 'DOWN'
    });

    const saved = await pool.query(
        'SELECT * FROM monitor_location_results WHERE monitor_id = $1',
        [monitorId]
    );

    expect(saved.rows).toHaveLength(1);
    expect(saved.rows[0]).toMatchObject({
        host_id: hostA,
        status: 'DOWN',
        response_time_ms: 1200,
        status_code: 503,
        error_type: 'HTTP_STATUS'
    });
});

test('ignores a checked_at supplied by the agent', async () => {
    const res = await post(keyA, {
        monitor_id: monitorId,
        status: 'UP',
        checked_at: '2001-01-01T00:00:00Z'
    });

    expect(res.status).toBe(201);
    expect(new Date(res.body.checked_at).getFullYear())
        .toBeGreaterThanOrEqual(2026);
});

test('returns 404 for a host that is not assigned to the monitor', async () => {
    const res = await post(keyB, { monitor_id: monitorId, status: 'UP' });

    expect(res.status).toBe(404);

    const saved = await pool.query(
        'SELECT 1 FROM monitor_location_results WHERE monitor_id = $1',
        [monitorId]
    );
    expect(saved.rows).toHaveLength(0);
});

test('returns 404 when the assigned host belongs to a different user', async () => {
    const other = await createUser();
    const otherUser = await pool.query(
        'SELECT id FROM users ORDER BY id DESC LIMIT 1'
    );
    expect(other.token).toBeTruthy();

    const c = newKey();
    const hostC = await createHost(otherUser.rows[0].id, 'foreign-agent', c.hash);

    // Bypass the API to force a cross-user assignment.
    await pool.query(
        'INSERT INTO monitor_locations (monitor_id, host_id) VALUES ($1, $2)',
        [monitorId, hostC]
    );

    const res = await post(c.apiKey, { monitor_id: monitorId, status: 'UP' });
    expect(res.status).toBe(404);
});

test('returns 404 for an inactive monitor', async () => {
    await pool.query('UPDATE monitors SET is_active = false WHERE id = $1', [
        monitorId
    ]);

    const res = await post(keyA, { monitor_id: monitorId, status: 'UP' });
    expect(res.status).toBe(404);
});

test.each([
    ['missing monitor_id', { status: 'UP' }],
    ['string monitor_id', { monitor_id: '1', status: 'UP' }],
    ['bad status', { monitor_id: 1, status: 'MAYBE' }],
    ['negative response time', { monitor_id: 1, status: 'UP', response_time_ms: -5 }],
    ['float response time', { monitor_id: 1, status: 'UP', response_time_ms: 1.5 }],
    ['status_code out of range', { monitor_id: 1, status: 'UP', status_code: 99 }],
    ['non-string error_message', { monitor_id: 1, status: 'DOWN', error_message: 5 }]
])('rejects %s with 400', async (_label, body) => {
    const res = await post(keyA, body);
    expect(res.status).toBe(400);
});