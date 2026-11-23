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

const validPayload = (overrides = {}) => ({
    sample_id: '123e4567-e89b-42d3-a456-426614174000',
    collected_at: '2026-11-23T08:40:00.000Z',
    metrics: [
        {
            metric_name: 'disk_usage',
            value: 65.4,
            unit: '%',
            tags: { mount: '/', device: 'sda1' }
        }
    ],
    ...overrides
});

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
        .post('/api/agent/custom-metrics')
        .set('x-api-key', key)
        .send(body);

const countCustomMetrics = async (id = hostId) => {
    const result = await pool.query(
        'SELECT COUNT(*) FROM custom_metrics WHERE host_id = $1',
        [id]
    );

    return Number(result.rows[0].count);
};

beforeAll(async () => {
    await resetDb();

    user = await createUser();

    const host = await registerHost('custom-metrics-host');
    hostId = host.id;
    apiKey = host.api_key;

    otherHostId = (await registerHost('custom-metrics-other-host')).id;
});

afterAll(async () => {
    await pool.end();
});

beforeEach(async () => {
    await pool.query('TRUNCATE custom_metrics RESTART IDENTITY');
    await pool.query('UPDATE hosts SET last_seen_at = NULL');
});

test('stores custom metrics under the authenticated host', async () => {
    const res = await send({
        ...validPayload(),
        host_id: otherHostId
    });

    expect(res.status).toBe(201);
    expect(res.body.inserted).toBe(1);
    expect(res.body.duplicates).toBe(0);
    expect(await countCustomMetrics(hostId)).toBe(1);
    expect(await countCustomMetrics(otherHostId)).toBe(0);

    const stored = await pool.query(
        `SELECT metric_name, value, unit, tags, collected_at
         FROM custom_metrics WHERE host_id = $1`,
        [hostId]
    );

    expect(stored.rows[0].metric_name).toBe('disk_usage');
    expect(Number(stored.rows[0].value)).toBe(65.4);
    expect(stored.rows[0].unit).toBe('%');
    expect(stored.rows[0].tags).toEqual({
        mount: '/',
        device: 'sda1'
    });
    expect(new Date(stored.rows[0].collected_at).toISOString())
        .toBe('2026-11-23T08:40:00.000Z');
});

test('updates last_seen_at when new custom metrics are inserted', async () => {
    const res = await send(validPayload());

    expect(res.status).toBe(201);

    const result = await pool.query(
        'SELECT last_seen_at FROM hosts WHERE id = $1',
        [hostId]
    );

    expect(result.rows[0].last_seen_at).not.toBeNull();
});

test('stores the same metric name with different tag dimensions', async () => {
    const payload = validPayload({
        metrics: [
            {
                metric_name: 'disk_usage',
                value: 65,
                unit: '%',
                tags: { mount: '/', device: 'sda1' }
            },
            {
                metric_name: 'disk_usage',
                value: 42,
                unit: '%',
                tags: { mount: '/data', device: 'sdb1' }
            }
        ]
    });

    const res = await send(payload);

    expect(res.status).toBe(201);
    expect(res.body.inserted).toBe(2);
    expect(await countCustomMetrics()).toBe(2);
});

test('ignores duplicate observations for the same sample and tags', async () => {
    const payload = validPayload();

    const first = await send(payload);
    const second = await send(payload);

    expect(first.status).toBe(201);
    expect(first.body.inserted).toBe(1);

    expect(second.status).toBe(200);
    expect(second.body.inserted).toBe(0);
    expect(second.body.duplicates).toBe(1);
    expect(await countCustomMetrics()).toBe(1);
});

test('inserts new observations while ignoring duplicates in a repeated batch', async () => {
    const first = validPayload({
        metrics: [
            {
                metric_name: 'disk_usage',
                value: 65,
                unit: '%',
                tags: { mount: '/' }
            },
            {
                metric_name: 'disk_usage',
                value: 42,
                unit: '%',
                tags: { mount: '/data' }
            }
        ]
    });

    const second = validPayload({
        metrics: [
            {
                metric_name: 'disk_usage',
                value: 65,
                unit: '%',
                tags: { mount: '/' }
            },
            {
                metric_name: 'disk_usage',
                value: 20,
                unit: '%',
                tags: { mount: '/backup' }
            }
        ]
    });

    const firstRes = await send(first);
    const secondRes = await send(second);

    expect(firstRes.status).toBe(201);
    expect(firstRes.body.inserted).toBe(2);

    expect(secondRes.status).toBe(201);
    expect(secondRes.body.inserted).toBe(1);
    expect(secondRes.body.duplicates).toBe(1);
    expect(await countCustomMetrics()).toBe(3);
});

test('rejects an invalid observation without inserting any part of the batch', async () => {
    const payload = validPayload({
        metrics: [
            {
                metric_name: 'valid_metric',
                value: 10,
                tags: {}
            },
            {
                metric_name: 'invalid metric name',
                value: 20,
                tags: {}
            }
        ]
    });

    const res = await send(payload);

    expect(res.status).toBe(400);
    expect(await countCustomMetrics()).toBe(0);
});

test('rejects an invalid sample ID', async () => {
    const res = await send(
        validPayload({ sample_id: 'not-a-uuid' })
    );

    expect(res.status).toBe(400);
    expect(await countCustomMetrics()).toBe(0);
});

test('rejects an invalid or future collected_at timestamp', async () => {
    const invalidDate = await send(
        validPayload({ collected_at: '2026-02-30T10:00:00Z' })
    );

    const futureDate = await send(
        validPayload({ collected_at: '2035-01-01T00:00:00Z' })
    );

    expect(invalidDate.status).toBe(400);
    expect(futureDate.status).toBe(400);
    expect(await countCustomMetrics()).toBe(0);
});

test('rejects batches exceeding the observation limit', async () => {
    const metrics = Array.from({ length: 201 }, (_, index) => ({
        metric_name: `metric_${index}`,
        value: index,
        tags: {}
    }));

    const res = await send(validPayload({ metrics }));

    expect(res.status).toBe(400);
    expect(await countCustomMetrics()).toBe(0);
});

test('rejects invalid tag values', async () => {
    const res = await send(
        validPayload({
            metrics: [
                {
                    metric_name: 'invalid_tags',
                    value: 10,
                    tags: { nested: { unsafe: true } }
                }
            ]
        })
    );

    expect(res.status).toBe(400);
    expect(await countCustomMetrics()).toBe(0);
});

test('rejects requests without a valid agent API key', async () => {
    const missingKey = await request(app)
        .post('/api/agent/custom-metrics')
        .send(validPayload());

    const invalidKey = await send(validPayload(), 'invalid-api-key');

    expect(missingKey.status).toBe(401);
    expect(invalidKey.status).toBe(401);
    expect(await countCustomMetrics()).toBe(0);
});

test('does not write custom metric observations into the built-in metrics table', async () => {
    const res = await send(validPayload());

    expect(res.status).toBe(201);

    const result = await pool.query(
        'SELECT COUNT(*) FROM metrics WHERE host_id = $1',
        [hostId]
    );

    expect(Number(result.rows[0].count)).toBe(0);
});
