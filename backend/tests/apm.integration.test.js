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

describe('GET /api/apm/traces (filters, sort, pagination)', () => {
    // Fixed mix: 2 slow successes, 1 fast success, 2 failures, 1 client error
    const seedMix = () =>
        pool.query(
            `INSERT INTO traces (host_id, method, route, status_code, duration_ms, timestamp)
             VALUES ($1, 'GET',  '/orders', 200, 900, NOW() - INTERVAL '1 minute'),
                    ($1, 'GET',  '/orders', 200, 700, NOW() - INTERVAL '2 minutes'),
                    ($1, 'GET',  '/orders', 200,  20, NOW() - INTERVAL '3 minutes'),
                    ($1, 'POST', '/orders', 500, 300, NOW() - INTERVAL '4 minutes'),
                    ($1, 'GET',  '/users',  503, 100, NOW() - INTERVAL '5 minutes'),
                    ($1, 'GET',  '/users',  404,  10, NOW() - INTERVAL '6 minutes')`,
            [hostId]
        );

    const list = (query, token) =>
        get('/traces', { host_id: hostId, ...query }, token);

    test('returns a pagination envelope, newest first by default', async () => {
        await seedMix();

        const res = await list({});

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ page: 1, page_size: 25, total: 6, total_pages: 1 });
        expect(res.body.items.map((t) => t.duration_ms)).toEqual([900, 700, 20, 300, 100, 10]);
    });

    test('sort=duration lists the slowest requests first', async () => {
        await seedMix();

        const res = await list({ sort: 'duration' });

        expect(res.body.items.map((t) => t.duration_ms)).toEqual([900, 700, 300, 100, 20, 10]);

        const asc = await list({ sort: 'duration', order: 'asc' });
        expect(asc.body.items.map((t) => t.duration_ms)).toEqual([10, 20, 100, 300, 700, 900]);
    });

    test('status filters pick out failing requests', async () => {
        await seedMix();

        const codes = async (status) =>
            (await list({ status, sort: 'status', order: 'asc' })).body.items.map((t) => t.status_code);

        expect(await codes('5xx')).toEqual([500, 503]);
        expect(await codes('4xx')).toEqual([404]);
        expect(await codes('2xx')).toEqual([200, 200, 200]);
        expect(await codes('error')).toEqual([404, 500, 503]);
    });

    test('filters by method, exact route and minimum duration', async () => {
        await seedMix();

        const durations = async (query) =>
            (await list({ sort: 'duration', ...query })).body.items.map((t) => t.duration_ms);

        expect(await durations({ method: 'post' })).toEqual([300]);
        expect(await durations({ route: '/users' })).toEqual([100, 10]);
        expect(await durations({ min_duration_ms: '300' })).toEqual([900, 700, 300]);
        expect(await durations({ route: '/orders', method: 'GET', min_duration_ms: '500' }))
            .toEqual([900, 700]);
    });

    test('a route filter is an exact match, not a pattern', async () => {
        await seedMix();

        const res = await list({ route: '/ord%' });

        expect(res.body.total).toBe(0);
    });

    test('paginates and reports totals', async () => {
        await seedMix();

        const first = await list({ page_size: '4' });
        expect(first.body).toMatchObject({ page: 1, page_size: 4, total: 6, total_pages: 2 });
        expect(first.body.items).toHaveLength(4);

        const second = await list({ page_size: '4', page: '2' });
        expect(second.body.items).toHaveLength(2);

        const ids = [...first.body.items, ...second.body.items].map((t) => t.id);
        expect(new Set(ids).size).toBe(6);

        const beyond = await list({ page_size: '4', page: '3' });
        expect(beyond.status).toBe(200);
        expect(beyond.body.items).toEqual([]);
        expect(beyond.body.total).toBe(6);
    });

    test('requests with no duration sort last whichever way you sort', async () => {
        await seedMix();
        await seedTrace('/aborted', null, null, '30 seconds');

        const desc = await list({ sort: 'duration' });
        const asc = await list({ sort: 'duration', order: 'asc' });

        expect(desc.body.items[desc.body.items.length - 1].duration_ms).toBeNull();
        expect(asc.body.items[asc.body.items.length - 1].duration_ms).toBeNull();
    });

    test('applies the time range', async () => {
        await seedTrace('/recent', 200, 5, '10 minutes');
        await seedTrace('/old', 200, 5, '3 hours');

        expect((await list({})).body.total).toBe(1);
        expect((await list({ range: '6h' })).body.total).toBe(2);
    });

    test.each([
        [{ sort: 'route' }],
        [{ order: 'sideways' }],
        [{ status: '6xx' }],
        [{ status: '5xx,4xx' }],
        [{ method: 'GET;DROP' }],
        [{ min_duration_ms: '-1' }],
        [{ min_duration_ms: '1.5' }],
        [{ min_duration_ms: 'abc' }],
        [{ page: '0' }],
        [{ page: '1.5' }],
        [{ page: '99999' }],
        [{ page_size: '0' }],
        [{ page_size: '101' }],
        [{ range: '30d' }]
    ])('rejects invalid query %j', async (query) => {
        const res = await list(query);

        expect(res.status).toBe(400);
        expect(typeof res.body.error).toBe('string');
    });

    test('rejects a repeated query key instead of crashing', async () => {
        const res = await request(app)
            .get(`/api/apm/traces?host_id=${hostId}&method=GET&method=POST`)
            .set(authHeader(owner.token));

        expect(res.status).toBe(400);
    });

    test('sort and order values are never interpolated from the request', async () => {
        await seedMix();

        const res = await list({ sort: 'duration_ms; DROP TABLE traces' });

        expect(res.status).toBe(400);
        expect((await pool.query('SELECT COUNT(*) FROM traces')).rows[0].count).toBe('6');
    });

    test('hides another user\'s host', async () => {
        await seedMix();

        expect((await list({}, stranger.token)).status).toBe(404);
        expect((await get('/traces', {})).status).toBe(400);
    });
});

describe('GET /api/apm/routes/detail', () => {
    const detail = (query, token) =>
        get('/routes/detail', { host_id: hostId, ...query }, token);

    test('returns stats, a status breakdown and a series for one route', async () => {
        await seedOrders();
        await seedTrace('/other', 500, 999, '2 minutes');
        await seedTrace('/orders', 200, 10, '3 hours'); // outside 1h

        const res = await detail({ method: 'GET', route: '/orders' });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            range: '1h',
            bucket_seconds: 60,
            method: 'GET',
            route: '/orders',
            request_count: 101,
            p50_duration_ms: 50,
            p95_duration_ms: 95,
            p99_duration_ms: 99,
            error_count: 4,
            client_error_count: 6,
            error_rate: 3.96
        });

        expect(res.body.status_codes).toEqual([
            { status_code: 200, request_count: 91 },
            { status_code: 404, request_count: 6 },
            { status_code: 500, request_count: 4 }
        ]);

        // the series only holds this route's traffic
        const total = res.body.points.reduce((sum, p) => sum + p.request_count, 0);
        expect(total).toBe(101);
    });

    test('does not mix methods that share a route', async () => {
        await seedTrace('/orders', 200, 10, '1 minute');
        await seedTrace('/orders', 500, 20, '1 minute');

        const get_ = await detail({ method: 'GET', route: '/orders' });
        const post = await detail({ method: 'POST', route: '/orders' });

        expect(get_.body.request_count).toBe(2);
        expect(post.body.request_count).toBe(0);
        expect(post.body.p95_duration_ms).toBeNull();
        expect(post.body.status_codes).toEqual([]);
    });

    test('requires method and route, and validates the range', async () => {
        expect((await detail({ route: '/orders' })).status).toBe(400);
        expect((await detail({ method: 'GET' })).status).toBe(400);
        expect((await detail({ method: 'GET', route: '/orders', range: 'nope' })).status).toBe(400);
    });

    test('hides another user\'s host', async () => {
        const res = await detail({ method: 'GET', route: '/orders' }, stranger.token);

        expect(res.status).toBe(404);
    });
});