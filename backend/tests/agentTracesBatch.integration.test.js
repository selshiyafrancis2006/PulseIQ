const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

let hostId;
let apiKey;

const countTraces = async () => {
    const result = await pool.query(
        'SELECT COUNT(*)::int AS count FROM traces WHERE host_id = $1',
        [hostId]
    );
    return result.rows[0].count;
};

beforeAll(async () => {
    await resetDb();

    const user = await createUser();

    const registration = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(user.token))
        .send({ name: 'trace-batch-host' });

    expect(registration.status).toBe(201);

    hostId = registration.body.id;
    apiKey = registration.body.api_key;
});

afterAll(async () => {
    await pool.end();
});

test('batch ingestion requires an API key', async () => {
    const response = await request(app)
        .post('/api/agent/traces/batch')
        .send({ traces: [{ method: 'GET', route: '/x' }] });

    expect(response.status).toBe(401);
});

test('batch ingestion stores every trace for the authenticated host', async () => {
    const before = await countTraces();

    const response = await request(app)
        .post('/api/agent/traces/batch')
        .set('x-api-key', apiKey)
        .send({
            traces: [
                { method: 'get', route: '/api/orders', status_code: 200, duration_ms: 12 },
                { method: 'POST', route: '/api/orders', status_code: 500, duration_ms: 340 },
                { method: 'GET', route: '/api/health' }
            ]
        });

    expect(response.status).toBe(201);
    expect(response.body.host_id).toBe(hostId);
    expect(response.body.accepted).toBe(3);

    expect((await countTraces()) - before).toBe(3);

    const rows = await pool.query(
        `SELECT method, route, status_code, duration_ms
         FROM traces
         WHERE host_id = $1 AND route = '/api/health'`,
        [hostId]
    );

    expect(rows.rows[0].method).toBe('GET');
    expect(rows.rows[0].status_code).toBeNull();
    expect(rows.rows[0].duration_ms).toBeNull();
});

test('batch ingestion keeps a recent client timestamp', async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const response = await request(app)
        .post('/api/agent/traces/batch')
        .set('x-api-key', apiKey)
        .send({
            traces: [
                {
                    method: 'GET',
                    route: '/api/recent-ts',
                    status_code: 200,
                    duration_ms: 5,
                    timestamp: tenMinutesAgo.toISOString()
                }
            ]
        });

    expect(response.status).toBe(201);

    const row = await pool.query(
        `SELECT timestamp FROM traces
         WHERE host_id = $1 AND route = '/api/recent-ts'`,
        [hostId]
    );

    const stored = new Date(row.rows[0].timestamp).getTime();

    expect(Math.abs(stored - tenMinutesAgo.getTime())).toBeLessThan(1000);
});

test('batch ingestion replaces a stale or future timestamp with server time', async () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const inAnHour = new Date(Date.now() + 60 * 60 * 1000);
    const startedAt = Date.now();

    const response = await request(app)
        .post('/api/agent/traces/batch')
        .set('x-api-key', apiKey)
        .send({
            traces: [
                { method: 'GET', route: '/api/stale-ts', timestamp: twoDaysAgo.toISOString() },
                { method: 'GET', route: '/api/future-ts', timestamp: inAnHour.toISOString() }
            ]
        });

    expect(response.status).toBe(201);

    const rows = await pool.query(
        `SELECT route, timestamp FROM traces
         WHERE host_id = $1 AND route IN ('/api/stale-ts', '/api/future-ts')`,
        [hostId]
    );

    expect(rows.rows).toHaveLength(2);

    for (const row of rows.rows) {
        const stored = new Date(row.timestamp).getTime();
        expect(stored).toBeGreaterThanOrEqual(startedAt - 1000);
        expect(stored).toBeLessThanOrEqual(Date.now() + 1000);
    }
});

test('accepts exactly 100 traces in one batch', async () => {
    const before = await countTraces();
    const traces = Array.from({ length: 100 }, (_, index) => ({
        method: 'GET',
        route: `/api/batch-limit/${index}`,
        status_code: 200,
        duration_ms: 1
    }));

    const response = await request(app)
        .post('/api/agent/traces/batch')
        .set('x-api-key', apiKey)
        .send({ traces });

    expect(response.status).toBe(201);
    expect(response.body.accepted).toBe(100);
    expect(response.body.rejected).toBe(0);
    expect(response.body.errors).toEqual([]);
    expect(await countTraces()).toBe(before + 100);
});
test.each([
    ['a missing traces field', {}],
    ['a non-array traces field', { traces: 'nope' }],
    ['an empty batch', { traces: [] }],
    ['a batch over the size limit', {
        traces: Array.from({ length: 101 }, () => ({ method: 'GET', route: '/x' }))
    }]
])('batch ingestion rejects %s', async (_description, payload) => {
    const before = await countTraces();

    const response = await request(app)
        .post('/api/agent/traces/batch')
        .set('x-api-key', apiKey)
        .send(payload);

    expect(response.status).toBe(400);
    expect(await countTraces()).toBe(before);
});

test.each([
    ['an invalid method', { method: '', route: '/x' }],
    ['an invalid route', { method: 'GET', route: '' }],
    ['an out-of-range status_code', { method: 'GET', route: '/x', status_code: 99 }],
    ['a negative duration', { method: 'GET', route: '/x', duration_ms: -1 }],
    ['an unparseable timestamp', { method: 'GET', route: '/x', timestamp: 'yesterday-ish' }],
    ['a non-object entry', 'not-an-object']
])('batch ingestion rejects only the invalid entry: %s', async (_description, bad) => {
    const before = await countTraces();

    const response = await request(app)
        .post('/api/agent/traces/batch')
        .set('x-api-key', apiKey)
        .send({
            traces: [
                { method: 'GET', route: '/api/good', status_code: 200, duration_ms: 1 },
                bad
            ]
        });

    expect(response.status).toBe(201);
    expect(response.body.accepted).toBe(1);
    expect(response.body.rejected).toBe(1);
    expect(response.body.errors).toEqual([
        { index: 1, error: expect.any(String) }
    ]);
    expect(await countTraces()).toBe(before + 1);
});