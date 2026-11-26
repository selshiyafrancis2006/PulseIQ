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

const serviceOf = async (route) => {
    const result = await pool.query(
        'SELECT service FROM traces WHERE host_id = $1 AND route = $2',
        [hostId, route]
    );
    return result.rows[0].service;
};

beforeAll(async () => {
    await resetDb();

    const user = await createUser();

    const registration = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(user.token))
        .send({ name: 'trace-service-host' });

    expect(registration.status).toBe(201);

    hostId = registration.body.id;
    apiKey = registration.body.api_key;
});

afterAll(async () => {
    await pool.end();
});

test('batch ingestion stores the service name trimmed, and NULL when missing or blank', async () => {
    const response = await request(app)
        .post('/api/agent/traces/batch')
        .set('x-api-key', apiKey)
        .send({
            traces: [
                { method: 'GET', route: '/svc/named', service: '  checkout-api  ' },
                { method: 'GET', route: '/svc/missing' },
                { method: 'GET', route: '/svc/blank', service: '   ' },
                { method: 'GET', route: '/svc/null', service: null }
            ]
        });

    expect(response.status).toBe(201);
    expect(response.body.accepted).toBe(4);

    expect(await serviceOf('/svc/named')).toBe('checkout-api');
    expect(await serviceOf('/svc/missing')).toBeNull();
    expect(await serviceOf('/svc/blank')).toBeNull();
    expect(await serviceOf('/svc/null')).toBeNull();
});

test('batch ingestion keeps different services from one host apart', async () => {
    const response = await request(app)
        .post('/api/agent/traces/batch')
        .set('x-api-key', apiKey)
        .send({
            traces: [
                { method: 'GET', route: '/svc/split', service: 'orders' },
                { method: 'GET', route: '/svc/split', service: 'billing' },
                { method: 'GET', route: '/svc/split', service: 'billing' }
            ]
        });

    expect(response.status).toBe(201);

    const result = await pool.query(
        `SELECT service, COUNT(*)::int AS count
         FROM traces
         WHERE host_id = $1 AND route = '/svc/split'
         GROUP BY service
         ORDER BY service`,
        [hostId]
    );

    expect(result.rows).toEqual([
        { service: 'billing', count: 2 },
        { service: 'orders', count: 1 }
    ]);
});

test('a 100 character service name is accepted', async () => {
    const name = 'a'.repeat(100);

    const response = await request(app)
        .post('/api/agent/traces/batch')
        .set('x-api-key', apiKey)
        .send({ traces: [{ method: 'GET', route: '/svc/max', service: name }] });

    expect(response.status).toBe(201);
    expect(await serviceOf('/svc/max')).toBe(name);
});

test('single trace endpoint stores the service name', async () => {
    const response = await request(app)
        .post('/api/agent/traces')
        .set('x-api-key', apiKey)
        .send({
            method: 'GET',
            route: '/svc/single',
            status_code: 200,
            duration_ms: 4,
            service: 'billing'
        });

    expect(response.status).toBe(201);
    expect(response.body.service).toBe('billing');
    expect(await serviceOf('/svc/single')).toBe('billing');
});

test('single trace endpoint still works without a service', async () => {
    const response = await request(app)
        .post('/api/agent/traces')
        .set('x-api-key', apiKey)
        .send({ method: 'GET', route: '/svc/single-none', duration_ms: 4 });

    expect(response.status).toBe(201);
    expect(response.body.service).toBeNull();
});

test.each([
    ['a number', 123],
    ['an object', { name: 'x' }],
    ['a name over 100 characters', 'x'.repeat(101)],
    ['a name with control characters', 'bad\u0007name']
])('batch ingestion rejects only an invalid service: %s', async (_description, service) => {
    const before = await countTraces();

    const response = await request(app)
        .post('/api/agent/traces/batch')
        .set('x-api-key', apiKey)
        .send({
            traces: [
                { method: 'GET', route: '/svc/good', service: 'ok' },
                { method: 'GET', route: '/svc/bad', service }
            ]
        });

    expect(response.status).toBe(201);
    expect(response.body.accepted).toBe(1);
    expect(response.body.rejected).toBe(1);
    expect(response.body.errors).toEqual([
        { index: 1, error: 'Invalid service' }
    ]);
    expect(await countTraces()).toBe(before + 1);
    expect(await serviceOf('/svc/good')).toBe('ok');
});

test.each([
    ['a number', 123],
    ['a name over 100 characters', 'x'.repeat(101)],
    ['a name with control characters', 'bad\u0007name']
])('single trace endpoint rejects %s as service', async (_description, service) => {
    const before = await countTraces();

    const response = await request(app)
        .post('/api/agent/traces')
        .set('x-api-key', apiKey)
        .send({ method: 'GET', route: '/svc/single-bad', service });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid service');
    expect(await countTraces()).toBe(before);
});