const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

let userA;
let userB;
let hostId;
let tokenA;
let tokenB;
let originalApiKey;

beforeAll(async () => {
    await resetDb();

    userA = await createUser();
    userB = await createUser();

    tokenA = userA.token;
    tokenB = userB.token;

    const response = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(tokenA))
        .send({ name: 'ownership-test-host' });

    expect(response.status).toBe(201);
hostId = response.body.id;
originalApiKey = response.body.api_key;
});

afterAll(async () => {
    await pool.end();
});

test('another user cannot read a host they do not own', async () => {
    const response = await request(app)
        .get(`/api/hosts/${hostId}`)
        .set(authHeader(tokenB));

    expect(response.status).toBe(404);
});

test('another user cannot rename a host they do not own', async () => {
    const response = await request(app)
        .patch(`/api/hosts/${hostId}`)
        .set(authHeader(tokenB))
        .send({ name: 'unauthorized-rename' });

    expect(response.status).toBe(404);
});

test('another user cannot regenerate a host API key', async () => {
    const response = await request(app)
        .post(`/api/hosts/${hostId}/regenerate-key`)
        .set(authHeader(tokenB));

    expect(response.status).toBe(404);
});

test('another user cannot delete a host they do not own', async () => {
    const response = await request(app)
        .delete(`/api/hosts/${hostId}`)
        .set(authHeader(tokenB));

    expect(response.status).toBe(404);

    // Confirm the actual owner still has access.
    const ownerResponse = await request(app)
        .get(`/api/hosts/${hostId}`)
        .set(authHeader(tokenA));

    expect(ownerResponse.status).toBe(200);
});

test('agent metrics endpoint rejects a missing API key', async () => {
    const response = await request(app)
        .post('/api/agent/metrics')
        .send({
            cpu_usage: 20,
            memory_usage: 30,
            disk_usage: 40,
            network_in: 100,
            network_out: 50
        });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Missing API key');
});

test('agent metrics endpoint rejects an invalid API key', async () => {
    const response = await request(app)
        .post('/api/agent/metrics')
        .set('x-api-key', 'invalid-test-api-key')
        .send({
            cpu_usage: 20,
            memory_usage: 30,
            disk_usage: 40,
            network_in: 100,
            network_out: 50
        });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Invalid API key');
});

test('invalid metrics do not update the host last_seen_at timestamp', async () => {
    const registration = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(tokenA))
        .send({ name: 'invalid-metrics-timestamp-host' });

    expect(registration.status).toBe(201);

    const testHostId = registration.body.id;
    const testApiKey = registration.body.api_key;

    const before = await pool.query(
        'SELECT last_seen_at FROM hosts WHERE id = $1',
        [testHostId]
    );

    const response = await request(app)
        .post('/api/agent/metrics')
        .set('x-api-key', testApiKey)
        .send({
            cpu_usage: 101,
            memory_usage: 30,
            disk_usage: 40,
            network_in: 100,
            network_out: 50
        });

    expect(response.status).toBe(400);

    const after = await pool.query(
        'SELECT last_seen_at FROM hosts WHERE id = $1',
        [testHostId]
    );

    expect(after.rows[0].last_seen_at).toEqual(
        before.rows[0].last_seen_at
    );
});

test('a user cannot register two hosts with the same name', async () => {
    const response = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(tokenA))
        .send({ name: 'ownership-test-host' });

    expect(response.status).toBe(409);
});

test('regenerating a host API key invalidates the old key', async () => {
    const originalKey = (
        await pool.query(
            'SELECT api_key_hash FROM hosts WHERE id = $1',
            [hostId]
        )
    ).rows[0].api_key_hash;

    const response = await request(app)
        .post(`/api/hosts/${hostId}/regenerate-key`)
        .set(authHeader(tokenA));

    expect(response.status).toBe(200);
    expect(response.body.api_key).toBeTruthy();
    expect(response.body.api_key).not.toBe(originalKey);

    const { hashApiKey } = require('../src/utils/apiKey');
    expect(hashApiKey(response.body.api_key)).not.toBe(originalKey);

    const oldKeyResponse = await request(app)
        .post('/api/agent/metrics')
        .set('x-api-key', originalApiKey)
        .send({
            cpu_usage: 20,
            memory_usage: 30,
            disk_usage: 40,
            network_in: 100,
            network_out: 50
        });

    expect(oldKeyResponse.status).toBe(401);

    const newKeyResponse = await request(app)
        .post('/api/agent/metrics')
        .set('x-api-key', response.body.api_key)
        .send({
            cpu_usage: 20,
            memory_usage: 30,
            disk_usage: 40,
            network_in: 100,
            network_out: 50
        });

    expect(newKeyResponse.status).toBe(201);

    const hostStatus = await pool.query(
    'SELECT last_seen_at FROM hosts WHERE id = $1',
    [hostId]
);

expect(hostStatus.rows[0].last_seen_at).not.toBeNull();

});

test.each(['abc', '0', '-1', '1.5'])(
    'GET host rejects invalid ID %s',
    async (id) => {
        const response = await request(app)
            .get(`/api/hosts/${id}`)
            .set(authHeader(tokenA));

        expect(response.status).toBe(404);
        expect(response.body.error).toBe('Host not found');
    }
);

test.each(['abc', '0', '-1', '1.5'])(
    'DELETE host rejects invalid ID %s',
    async (id) => {
        const response = await request(app)
            .delete(`/api/hosts/${id}`)
            .set(authHeader(tokenA));

        expect(response.status).toBe(404);
        expect(response.body.error).toBe('Host not found');
    }
);

test('a user can update only a host’s tags', async () => {
    const response = await request(app)
        .patch(`/api/hosts/${hostId}`)
        .set(authHeader(tokenA))
        .send({ tags: ['env:test', 'team:backend'] });

    expect(response.status).toBe(200);
    expect(response.body.name).toBe('ownership-test-host');
    expect(response.body.tags).toEqual(['env:test', 'team:backend']);
});

test('an empty host update is rejected', async () => {
    const response = await request(app)
        .patch(`/api/hosts/${hostId}`)
        .set(authHeader(tokenA))
        .send({});

    expect(response.status).toBe(400);
});

test.each([
    ['missing method', {
        route: '/api/orders',
        status_code: 200,
        duration_ms: 25
    }],
    ['missing route', {
        method: 'GET',
        status_code: 200,
        duration_ms: 25
    }],
    ['invalid status code', {
        method: 'GET',
        route: '/api/orders',
        status_code: 700,
        duration_ms: 25
    }],
    ['negative duration', {
        method: 'GET',
        route: '/api/orders',
        status_code: 200,
        duration_ms: -1
    }],
    ['non-numeric duration', {
        method: 'GET',
        route: '/api/orders',
        status_code: 200,
        duration_ms: 'fast'
    }]
])('agent trace ingestion rejects %s', async (_description, payload) => {
    const registration = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(tokenA))
        .send({ name: `trace-test-${Date.now()}-${Math.random()}` });

    expect(registration.status).toBe(201);

    const response = await request(app)
        .post('/api/agent/traces')
        .set('x-api-key', registration.body.api_key)
        .send(payload);

    expect(response.status).toBe(400);
});

test('agent accepts a valid trace and optional fields', async () => {
    const registration = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(tokenA))
        .send({ name: `valid-trace-${Date.now()}` });

    expect(registration.status).toBe(201);

    const response = await request(app)
        .post('/api/agent/traces')
        .set('x-api-key', registration.body.api_key)
        .send({
            method: 'get',
            route: '/api/orders',
            status_code: 200,
            duration_ms: 25
        });

    expect(response.status).toBe(201);
    expect(response.body.method).toBe('GET');
    expect(response.body.route).toBe('/api/orders');
    expect(response.body.status_code).toBe(200);
    expect(response.body.duration_ms).toBe(25);
    expect(response.body.host_id).toBe(registration.body.id);
});

test.each(['abc', '0', '-1', '1.5'])(
    'PATCH host rejects invalid ID %s',
    async (id) => {
        const response = await request(app)
            .patch(`/api/hosts/${id}`)
            .set(authHeader(tokenA))
            .send({ name: 'invalid-id-test' });

        expect(response.status).toBe(404);
        expect(response.body.error).toBe('Host not found');
    }
);

test.each(['abc', '0', '-1', '1.5'])(
    'key regeneration rejects invalid host ID %s',
    async (id) => {
        const response = await request(app)
            .post(`/api/hosts/${id}/regenerate-key`)
            .set(authHeader(tokenA));

        expect(response.status).toBe(404);
        expect(response.body.error).toBe('Host not found');
    }
);

test.each([
    ['empty name', ''],
    ['whitespace-only name', '   '],
    ['name exceeding 255 characters', 'a'.repeat(256)],
    ['name containing a control character', 'invalid\nname']
])('host registration rejects %s', async (_description, name) => {
    const response = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(tokenA))
        .send({ name });

    expect(response.status).toBe(400);
});

test.each([
    ['more than 20 tags', Array.from({ length: 21 }, (_, i) => `tag:${i}`)],
    ['a tag exceeding 64 characters', ['a'.repeat(65)]],
    ['a tag containing a control character', ['invalid\n tag']]
])('host registration rejects %s', async (_description, tags) => {
    const response = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(tokenA))
        .send({
            name: `validation-test-${Date.now()}-${Math.random()}`,
            tags
        });

    expect(response.status).toBe(400);
});
