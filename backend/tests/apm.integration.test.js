const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

let owner;
let stranger;
let hostId;
let emptyHostId;

const registerHost = async (token, name) => {
    const res = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(token))
        .send({ name });

    expect(res.status).toBe(201);
    return res.body.id;
};

// 101 requests on GET /orders, 5 minutes ago, with durations 0..100 ms so the
// percentiles are exact: p50 = 50, p95 = 95, p99 = 99.
// 4 of them are 500s, 6 are 404s, the other 91 are 200s.
const seedOrders = () =>
    pool.query(
        `INSERT INTO traces (host_id, method, route, status_code, duration_ms, timestamp)
         SELECT $1, 'GET', '/orders',
                CASE WHEN n < 4 THEN 500 WHEN n < 10 THEN 404 ELSE 200 END,
                n,
                NOW() - INTERVAL '5 minutes'
         FROM generate_series(0, 100) AS n`,
        [hostId]
    );

const seedTrace = (route, status, duration, ago) =>
    pool.query(
        `INSERT INTO traces (host_id, method, route, status_code, duration_ms, timestamp)
         VALUES ($1, 'GET', $2, $3, $4, NOW() - $5::interval)`,
        [hostId, route, status, duration, ago]
    );

const get = (path, query, token = owner.token) =>
    request(app).get(`/api/apm${path}`).query(query).set(authHeader(token));

beforeAll(async () => {
    await resetDb();

    owner = await createUser();
    stranger = await createUser();

    hostId = await registerHost(owner.token, 'apm-host');
    emptyHostId = await registerHost(owner.token, 'apm-empty-host');
});

beforeEach(async () => {
    await pool.query('DELETE FROM traces');
});

afterAll(async () => {
    await pool.end();
});

describe('GET /api/apm/traces/summary', () => {
    test('reports p50/p95/p99 and a 5xx-based error rate per route', async () => {
        await seedOrders();

        const res = await get('/traces/summary', { host_id: hostId });

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);

        const row = res.body[0];
        expect(row).toMatchObject({
            method: 'GET',
            route: '/orders',
            request_count: 101,
            avg_duration_ms: 50,
            max_duration_ms: 100,
            p50_duration_ms: 50,
            p95_duration_ms: 95,
            p99_duration_ms: 99,
            error_count: 4,
            client_error_count: 6
        });
        // 4 / 101 = 3.96%; the six 404s do not count
        expect(row.error_rate).toBe(3.96);
    });

    test('orders routes by p95, slowest first', async () => {
        await seedTrace('/fast', 200, 10, '1 minute');
        await seedTrace('/slow', 200, 900, '1 minute');
        await seedTrace('/medium', 200, 200, '1 minute');

        const res = await get('/traces/summary', { host_id: hostId });

        expect(res.body.map((r) => r.route)).toEqual(['/slow', '/medium', '/fast']);
    });

    test('ignores requests that have no duration when computing percentiles', async () => {
        await seedTrace('/x', 200, 100, '1 minute');
        await seedTrace('/x', null, null, '1 minute');

        const res = await get('/traces/summary', { host_id: hostId });

        expect(res.body[0].request_count).toBe(2);
        expect(res.body[0].p95_duration_ms).toBe(100);
        expect(res.body[0].error_rate).toBe(0);
    });

    test('defaults to the last hour and honours the range selector', async () => {
        await seedTrace('/recent', 200, 10, '10 minutes');
        await seedTrace('/older', 200, 10, '3 hours');
        await seedTrace('/oldest', 200, 10, '3 days');

        const routes = async (query) =>
            (await get('/traces/summary', { host_id: hostId, ...query })).body
                .map((r) => r.route)
                .sort();

        expect(await routes({})).toEqual(['/recent']);
        expect(await routes({ range: '15m' })).toEqual(['/recent']);
        expect(await routes({ range: '6h' })).toEqual(['/older', '/recent']);
        expect(await routes({ range: '7d' })).toEqual(['/older', '/oldest', '/recent']);
    });

    test.each(['2h', '1H', 'abc', '0', '1h; DROP TABLE traces'])(
        'rejects an unsupported range %s',
        async (range) => {
            const res = await get('/traces/summary', { host_id: hostId, range });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/range must be one of/);
        }
    );

    test('requires a host_id', async () => {
        const res = await get('/traces/summary', {});

        expect(res.status).toBe(400);
    });

    test('hides another user\'s host', async () => {
        await seedOrders();

        const res = await get('/traces/summary', { host_id: hostId }, stranger.token);

        expect(res.status).toBe(404);
    });
});

describe('GET /api/apm/traces/overview', () => {
    test('returns host-wide percentiles, error rate and throughput', async () => {
        await seedOrders();
        await seedTrace('/other', 503, 100, '2 minutes');

        const res = await get('/traces/overview', { host_id: hostId, range: '15m' });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            range: '15m',
            request_count: 102,
            error_count: 5,
            client_error_count: 6
        });
        // 5 / 102 = 4.90%
        expect(res.body.error_rate).toBe(4.9);
        // 102 requests over 15 minutes
        expect(res.body.throughput_rpm).toBe(6.8);
        expect(res.body.p95_duration_ms).toBeGreaterThanOrEqual(95);
        expect(res.body.p99_duration_ms).toBeGreaterThanOrEqual(res.body.p95_duration_ms);
    });

    test('returns zeros and nulls, not an error, for a host with no traffic', async () => {
        const res = await get('/traces/overview', { host_id: emptyHostId });

        expect(res.status).toBe(200);
        expect(res.body.request_count).toBe(0);
        expect(res.body.error_count).toBe(0);
        expect(res.body.throughput_rpm).toBe(0);
        expect(res.body.p95_duration_ms).toBeNull();
        expect(res.body.error_rate).toBeNull();
    });

    test('is scoped to the requested host', async () => {
        await seedOrders();

        const res = await get('/traces/overview', { host_id: emptyHostId });

        expect(res.body.request_count).toBe(0);
    });

    test('hides another user\'s host', async () => {
        const res = await get('/traces/overview', { host_id: hostId }, stranger.token);

        expect(res.status).toBe(404);
    });
});

describe('GET /api/apm/traces/timeseries', () => {
    test('buckets traffic with date_bin and keeps empty buckets', async () => {
        // One statement, so both 10-minute traces share a timestamp and
        // cannot straddle a bucket boundary.
        await pool.query(
            `INSERT INTO traces (host_id, method, route, status_code, duration_ms, timestamp)
             VALUES ($1, 'GET', '/a', 200, 100, NOW() - INTERVAL '10 minutes'),
                    ($1, 'GET', '/a', 500, 300, NOW() - INTERVAL '10 minutes'),
                    ($1, 'GET', '/a', 200, 50, NOW() - INTERVAL '40 minutes')`,
            [hostId]
        );

        const res = await get('/traces/timeseries', { host_id: hostId, range: '1h' });

        expect(res.status).toBe(200);
        expect(res.body.range).toBe('1h');
        expect(res.body.bucket_seconds).toBe(60);

        const { points } = res.body;

        // 60 one-minute buckets covering the hour, plus the current partial one
        expect(points.length).toBeGreaterThanOrEqual(60);
        expect(points.length).toBeLessThanOrEqual(62);

        // buckets are consecutive and evenly spaced
        for (let i = 1; i < points.length; i += 1) {
            expect(
                new Date(points[i].bucket) - new Date(points[i - 1].bucket)
            ).toBe(60 * 1000);
        }

        const busy = points.filter((p) => p.request_count > 0);
        expect(busy).toHaveLength(2);
        expect(points.reduce((sum, p) => sum + p.request_count, 0)).toBe(3);

        const tenMinutes = busy.find((p) => p.request_count === 2);
        expect(tenMinutes).toMatchObject({
            error_count: 1,
            error_rate: 50,
            max_duration_ms: 300,
            throughput_rpm: 2
        });
        expect(tenMinutes.p50_duration_ms).toBe(200);

        const quiet = points.find((p) => p.request_count === 0);
        expect(quiet).toMatchObject({
            error_count: 0,
            throughput_rpm: 0,
            p95_duration_ms: null,
            error_rate: null
        });
    });

    test('uses wider buckets for longer ranges', async () => {
        await seedTrace('/a', 200, 10, '1 hour');

        const widths = {};
        for (const range of ['15m', '6h', '24h', '7d']) {
            const res = await get('/traces/timeseries', { host_id: hostId, range });
            expect(res.status).toBe(200);
            widths[range] = res.body.bucket_seconds;
        }

        expect(widths).toEqual({ '15m': 30, '6h': 300, '24h': 900, '7d': 3600 });
    });

    test('does not count traces from before the range', async () => {
        await seedTrace('/a', 200, 10, '2 hours');

        const res = await get('/traces/timeseries', { host_id: hostId, range: '1h' });

        expect(res.body.points.every((p) => p.request_count === 0)).toBe(true);
    });

    test('rejects an unsupported range and a foreign host', async () => {
        const bad = await get('/traces/timeseries', { host_id: hostId, range: '30d' });
        expect(bad.status).toBe(400);

        const foreign = await get('/traces/timeseries', { host_id: hostId }, stranger.token);
        expect(foreign.status).toBe(404);
    });
});