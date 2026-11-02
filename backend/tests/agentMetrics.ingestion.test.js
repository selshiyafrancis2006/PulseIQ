const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

let user;
let hostId;
let otherHostId;
let apiKey;

const validMetrics = {
    cpu_usage: 12.5,
    memory_usage: 48,
    disk_usage: 71.2,
    network_in: 1500,
    network_out: 900
};

async function registerHost(name) {
    const res = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(user.token))
        .send({ name });

    expect(res.status).toBe(201);
    return res.body;
}

const send = (body, key = apiKey) =>
    request(app)
        .post('/api/agent/metrics')
        .set('x-api-key', key)
        .send(body);

const countMetrics = async (id) =>
    Number((await pool.query(
        'SELECT COUNT(*) FROM metrics WHERE host_id = $1', [id]
    )).rows[0].count);

beforeAll(async () => {
    await resetDb();
    user = await createUser();

    const host = await registerHost('ingest-host');
    hostId = host.id;
    apiKey = host.api_key;

    otherHostId = (await registerHost('ingest-other-host')).id;
});

afterAll(async () => {
    await pool.end();
});

beforeEach(async () => {
    await pool.query('TRUNCATE metrics RESTART IDENTITY');
    await pool.query('UPDATE hosts SET last_seen_at = NULL');
});

describe('POST /api/agent/metrics - storing', () => {
    test('stores the reading for the host that owns the API key', async () => {
        const res = await send(validMetrics);

        expect(res.status).toBe(201);
        expect(res.body).toEqual(expect.objectContaining({
            host_id: hostId,
            cpu_usage: 12.5,
            memory_usage: 48,
            disk_usage: 71.2,
            network_in: 1500,
            network_out: 900
        }));

        const stored = await pool.query('SELECT * FROM metrics WHERE host_id = $1', [hostId]);
        expect(stored.rows).toHaveLength(1);
        expect(stored.rows[0].cpu_usage).toBe(12.5);
        expect(await countMetrics(otherHostId)).toBe(0);
    });

    test('ignores a host_id sent in the body and uses the key owner instead', async () => {
        const res = await send({ ...validMetrics, host_id: otherHostId });

        expect(res.status).toBe(201);
        expect(await countMetrics(hostId)).toBe(1);
        expect(await countMetrics(otherHostId)).toBe(0);
    });

    test('uses the server clock, not a timestamp sent by the agent', async () => {
        const res = await send({ ...validMetrics, timestamp: '2001-01-01T00:00:00Z' });

        expect(res.status).toBe(201);
        expect(new Date(res.body.timestamp).getFullYear()).toBeGreaterThan(2020);
    });

    test('updates last_seen_at for the host', async () => {
        await send(validMetrics);

        const row = await pool.query('SELECT last_seen_at FROM hosts WHERE id = $1', [hostId]);
        expect(row.rows[0].last_seen_at).not.toBeNull();

        const other = await pool.query('SELECT last_seen_at FROM hosts WHERE id = $1', [otherHostId]);
        expect(other.rows[0].last_seen_at).toBeNull();
    });

    test('accepts boundary values 0 and 100 for percentages', async () => {
        const low = await send({ ...validMetrics, cpu_usage: 0, memory_usage: 0, disk_usage: 0 });
        const high = await send({ ...validMetrics, cpu_usage: 100, memory_usage: 100, disk_usage: 100 });

        expect(low.status).toBe(201);
        expect(high.status).toBe(201);
    });

    test('network rates above 100 are valid (they are not percentages)', async () => {
        const res = await send({ ...validMetrics, network_in: 5_000_000, network_out: 250_000 });

        expect(res.status).toBe(201);
    });
});

describe('POST /api/agent/metrics - validation', () => {
    test.each([
        ['cpu_usage above 100', { cpu_usage: 100.1 }, 'cpu_usage'],
        ['memory_usage above 100', { memory_usage: 101 }, 'memory_usage'],
        ['disk_usage above 100', { disk_usage: 250 }, 'disk_usage'],
        ['negative cpu_usage', { cpu_usage: -1 }, 'cpu_usage'],
        ['negative network_in', { network_in: -5 }, 'network_in'],
        ['string network_out', { network_out: '900' }, 'network_out'],
        ['null disk_usage', { disk_usage: null }, 'disk_usage'],
        ['NaN-like cpu_usage', { cpu_usage: 'NaN' }, 'cpu_usage'],
        ['boolean memory_usage', { memory_usage: true }, 'memory_usage']
    ])('rejects %s and stores nothing', async (_label, override, field) => {
        const res = await send({ ...validMetrics, ...override });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain(field);
        expect(await countMetrics(hostId)).toBe(0);
    });

    test.each([
        'cpu_usage',
        'memory_usage',
        'disk_usage',
        'network_in',
        'network_out'
    ])('rejects a reading that is missing %s', async (field) => {
        const body = { ...validMetrics };
        delete body[field];

        const res = await send(body);

        expect(res.status).toBe(400);
        expect(res.body.error).toContain(field);
        expect(await countMetrics(hostId)).toBe(0);
    });

    test('rejects an empty body', async () => {
        const res = await send({});

        expect(res.status).toBe(400);
    });
});

describe('POST /api/agent/metrics - optional host metadata', () => {
    test('saves valid metadata on the host', async () => {
        const res = await send({
            ...validMetrics,
            metadata: { hostname: 'build-box', os: 'Ubuntu 24.04', cpu_cores: 8 }
        });

        expect(res.status).toBe(201);

        const host = await pool.query(
            'SELECT hostname, os, cpu_cores FROM hosts WHERE id = $1', [hostId]
        );
        expect(host.rows[0]).toEqual({
            hostname: 'build-box',
            os: 'Ubuntu 24.04',
            cpu_cores: 8
        });
    });

    test.each([
        ['a string', 'not-an-object'],
        ['an array of junk', [1, 2, 3]],
        ['null', null]
    ])('metadata that is %s never blocks metric ingestion', async (_label, metadata) => {
        const res = await send({ ...validMetrics, metadata });

        expect(res.status).toBe(201);
        expect(await countMetrics(hostId)).toBe(1);
    });
});

describe('POST /api/agent/metrics - authentication', () => {
    test('rejects a request with no API key', async () => {
        const res = await request(app).post('/api/agent/metrics').send(validMetrics);

        expect(res.status).toBe(401);
        expect(await countMetrics(hostId)).toBe(0);
    });

    test('rejects an unknown API key', async () => {
        const res = await send(validMetrics, 'pk_not_a_real_key');

        expect(res.status).toBe(401);
        expect(await countMetrics(hostId)).toBe(0);
    });

    test('a user JWT is not accepted in place of an agent key', async () => {
        const res = await request(app)
            .post('/api/agent/metrics')
            .set(authHeader(user.token))
            .send(validMetrics);

        expect(res.status).toBe(401);
    });
});