const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

const metricsQueryService = require('../src/services/metricsQuery.service');
const {
    RAW_RETENTION_DAYS,
    ROLLUP_5M_RETENTION_DAYS
} = require('../src/services/metricRollup.service');

let userA;
let userB;
let hostA;
let hostA2;

async function registerHost(token, name) {
    const res = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(token))
        .send({ name });

    expect(res.status).toBe(201);
    return res.body.id;
}

// Inserts one raw metric row "secondsAgo" seconds in the past.
async function insertRaw(hostId, secondsAgo, cpu, extra = {}) {
    await pool.query(
        `INSERT INTO metrics
            (host_id, timestamp, cpu_usage, memory_usage, disk_usage, network_in, network_out)
         VALUES ($1, NOW() - ($2 || ' seconds')::interval, $3, $4, $5, $6, $7)`,
        [
            hostId,
            String(secondsAgo),
            cpu,
            extra.memory ?? 40,
            extra.disk ?? 50,
            extra.netIn ?? 1000,
            extra.netOut ?? 2000
        ]
    );
}

async function insertRawAt(hostId, timestamp, values = {}) {
    await pool.query(
        `INSERT INTO metrics
            (host_id, timestamp, collected_at,
             cpu_usage, memory_usage, disk_usage, network_in, network_out)
         VALUES ($1, $2::timestamptz, $2::timestamptz, $3, $4, $5, $6, $7)`,
        [
            hostId,
            timestamp,
            values.cpu ?? 40,
            values.memory ?? 50,
            values.disk ?? 60,
            values.netIn ?? 1000,
            values.netOut ?? 2000
        ]
    );
}
async function insertRollup(table, hostId, hoursAgo, cpuAvg) {
    await pool.query(
        `INSERT INTO ${table}
            (host_id, bucket_start,
             cpu_usage_avg, cpu_usage_min, cpu_usage_max,
             memory_usage_avg, memory_usage_min, memory_usage_max,
             disk_usage_avg, disk_usage_min, disk_usage_max,
             network_in_avg, network_in_min, network_in_max,
             network_out_avg, network_out_min, network_out_max,
             sample_count)
         VALUES ($1, date_trunc('hour', NOW()) - ($2 || ' hours')::interval,
                 $3::double precision, $3::double precision - 5, $3::double precision + 5,
                 41, 36, 46,
                 51, 46, 56,
                 1001, 996, 1006,
                 2001, 1996, 2006,
                 10)`,
        [hostId, String(hoursAgo), cpuAvg]
    );
}

beforeAll(async () => {
    await resetDb();

    userA = await createUser();
    userB = await createUser();

    hostA = await registerHost(userA.token, 'metrics-host-a');
    hostA2 = await registerHost(userA.token, 'metrics-host-a2');
});

afterAll(async () => {
    await pool.end();
});

beforeEach(async () => {
    await pool.query('TRUNCATE custom_metrics, metrics, metric_rollups_5m, metric_rollups_1h RESTART IDENTITY');
});

describe('GET /api/metrics - access and validation', () => {
    test('rejects a request without a token', async () => {
        const res = await request(app).get(`/api/metrics?host_id=${hostA}`);

        expect(res.status).toBe(401);
    });

    test('returns 400 for an unsupported metrics range', async () => {
        const res = await request(app)
            .get('/api/metrics?host_id=' + hostA + '&range=10m')
            .set(authHeader(userA.token));

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Invalid range/);
        expect(res.body.error).toContain('90d');
    });

    test.each([
        ['missing', ''],
        ['non-numeric', '?host_id=abc'],
        ['zero', '?host_id=0'],
        ['negative', '?host_id=-3'],
        ['decimal', '?host_id=1.5']
    ])('returns 400 when host_id is %s', async (_label, query) => {
        const res = await request(app)
            .get(`/api/metrics${query}`)
            .set(authHeader(userA.token));

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/host_id/);
    });

    test("returns 404 for another user's host and leaks no data", async () => {
        await insertRaw(hostA, 5, 77);

        const res = await request(app)
            .get(`/api/metrics?host_id=${hostA}&range=1h`)
            .set(authHeader(userB.token));

        expect(res.status).toBe(404);
        expect(JSON.stringify(res.body)).not.toContain('77');
    });

    test('returns 404 for a host that does not exist', async () => {
        const res = await request(app)
            .get('/api/metrics?host_id=999999')
            .set(authHeader(userA.token));

        expect(res.status).toBe(404);
    });
});

describe('GET /api/metrics - raw ranges', () => {
    test('returns only rows of the requested host inside the range, oldest first', async () => {
        await insertRaw(hostA, 600, 10);      // 10 minutes ago: outside 5m
        await insertRaw(hostA, 120, 20);      // inside 5m
        await insertRaw(hostA, 30, 30);       // inside 5m
        await insertRaw(hostA2, 30, 99);      // other host of the same user

        const res = await request(app)
            .get(`/api/metrics?host_id=${hostA}&range=5m`)
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body.map((row) => row.cpu_usage)).toEqual([20, 30]);
        expect(res.body.every((row) => row.host_id === hostA)).toBe(true);
    });

    test('defaults to the last minute when no range is given', async () => {
        await insertRaw(hostA, 30, 11);
        await insertRaw(hostA, 300, 22);

        const res = await request(app)
            .get(`/api/metrics?host_id=${hostA}`)
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body.map((row) => row.cpu_usage)).toEqual([11]);
    });

    test('1h range includes rows from 50 minutes ago but not 70 minutes ago', async () => {
        await insertRaw(hostA, 50 * 60, 5);
        await insertRaw(hostA, 70 * 60, 6);

        const res = await request(app)
            .get(`/api/metrics?host_id=${hostA}&range=1h`)
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body.map((row) => row.cpu_usage)).toEqual([5]);
    });

    test('returns an empty array when the host has no data', async () => {
        const res = await request(app)
            .get(`/api/metrics?host_id=${hostA}&range=15m`)
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });
});

// Start of the bucket "bucketsAgo" buckets before the current one, in ms.
const bucketStart = (stepMs, bucketsAgo) =>
    Math.floor(Date.now() / stepMs) * stepMs - bucketsAgo * stepMs;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

describe('GET /api/metrics - long ranges (6h to 90d)', () => {
    const get = (range, hostId = hostA) =>
        request(app)
            .get(`/api/metrics?host_id=${hostId}&range=${range}`)
            .set(authHeader(userA.token));

    test('6h groups raw samples into 5-minute buckets with avg, min, max and sample_count', async () => {
        const bucket = bucketStart(5 * MINUTE, 36); // 3 hours ago

        await insertRawAt(hostA, new Date(bucket + MINUTE).toISOString(), { cpu: 20, memory: 10, disk: 70, netIn: 100, netOut: 200 });
        await insertRawAt(hostA, new Date(bucket + 2 * MINUTE).toISOString(), { cpu: 40, memory: 30, disk: 90, netIn: 300, netOut: 400 });
        await insertRawAt(hostA, new Date(Date.now() - 8 * HOUR).toISOString(), { cpu: 88 }); // older than 6h
        await insertRawAt(hostA2, new Date(bucket + MINUTE).toISOString(), { cpu: 99 });       // other host

        const res = await get('6h');

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0]).toEqual(expect.objectContaining({
            host_id: hostA,
            cpu_usage: 30,
            cpu_usage_min: 20,
            cpu_usage_max: 40,
            memory_usage: 20,
            memory_usage_min: 10,
            memory_usage_max: 30,
            disk_usage: 80,
            disk_usage_min: 70,
            disk_usage_max: 90,
            network_in: 200,
            network_in_min: 100,
            network_in_max: 300,
            network_out: 300,
            network_out_min: 200,
            network_out_max: 400,
            sample_count: '2'
        }));
        expect(new Date(res.body[0].timestamp).getTime()).toBe(bucket);
    });

    test.each(['6h', '24h', '3d', '7d'])(
        '%s includes the newest raw sample, with no stale tail',
        async (range) => {
            await insertRaw(hostA, 10, 55);

            const res = await get(range);

            expect(res.status).toBe(200);
            expect(res.body.at(-1).cpu_usage).toBe(55);
        }
    );

    test('24h keeps data up to a day old and drops older data', async () => {
        await insertRawAt(hostA, new Date(Date.now() - 20 * HOUR).toISOString(), { cpu: 20 });
        await insertRawAt(hostA, new Date(Date.now() - 30 * HOUR).toISOString(), { cpu: 30 });

        const res = await get('24h');

        expect(res.body.map((row) => row.cpu_usage)).toEqual([20]);
    });

    test('3d returns 15-minute buckets', async () => {
        const bucket = bucketStart(15 * MINUTE, 8); // 2 hours ago

        await insertRawAt(hostA, new Date(bucket + MINUTE).toISOString(), { cpu: 10 });
        await insertRawAt(hostA, new Date(bucket + 11 * MINUTE).toISOString(), { cpu: 30 });

        const res = await get('3d');

        expect(res.body).toHaveLength(1);
        expect(res.body[0].cpu_usage).toBe(20);
        expect(res.body[0].cpu_usage_min).toBe(10);
        expect(res.body[0].cpu_usage_max).toBe(30);
    });

    test('7d reads 5-minute rollups for data older than raw retention, in hourly buckets', async () => {
        await insertRollup('metric_rollups_5m', hostA, 24 * 5, 50);
        await insertRollup('metric_rollups_1h', hostA2, 24 * 5, 77); // other host
        await insertRaw(hostA, 10, 1);

        const res = await get('7d');

        expect(res.status).toBe(200);
        expect(res.body.map((row) => row.cpu_usage)).toEqual([50, 1]);
        expect(res.body[0]).toEqual(expect.objectContaining({
            cpu_usage_min: 45,
            cpu_usage_max: 55,
            memory_usage_min: 36,
            memory_usage_max: 46,
            sample_count: '10'
        }));
    });

    test('30d and 90d read hourly rollups for old data and ignore data beyond the range', async () => {
        await insertRollup('metric_rollups_1h', hostA, 24 * 9, 90);
        await insertRollup('metric_rollups_1h', hostA, 24 * 20, 20);
        await insertRollup('metric_rollups_1h', hostA, 24 * 40, 40);
        await insertRollup('metric_rollups_1h', hostA, 24 * 80, 80);
        await insertRollup('metric_rollups_1h', hostA, 24 * 95, 95);

        const thirty = await get('30d');
        const ninety = await get('90d');

        expect(thirty.status).toBe(200);
        expect(thirty.body.map((row) => row.cpu_usage)).toEqual([20, 90]);
        expect(ninety.body.map((row) => row.cpu_usage)).toEqual([80, 40, 20, 90]);
        expect(ninety.body[0]).toEqual(expect.objectContaining({
            cpu_usage_min: 75,
            cpu_usage_max: 85
        }));
    });

    test('returns an empty array when the host has no data', async () => {
        const res = await get('7d');

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });
});

describe('GET /api/metrics/latest', () => {
    test('returns the newest row of the host', async () => {
        await insertRaw(hostA, 100, 10);
        await insertRaw(hostA, 5, 55);
        await insertRaw(hostA2, 1, 99);

        const res = await request(app)
            .get(`/api/metrics/latest?host_id=${hostA}`)
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body.cpu_usage).toBe(55);
        expect(res.body.host_id).toBe(hostA);
    });

    test('returns null when the host has no metrics yet', async () => {
        const res = await request(app)
            .get(`/api/metrics/latest?host_id=${hostA}`)
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body).toBeNull();
    });

    test('requires a valid host_id', async () => {
        const res = await request(app)
            .get('/api/metrics/latest')
            .set(authHeader(userA.token));

        expect(res.status).toBe(400);
    });

    test("returns 404 for another user's host", async () => {
        await insertRaw(hostA, 5, 55);

        const res = await request(app)
            .get(`/api/metrics/latest?host_id=${hostA}`)
            .set(authHeader(userB.token));

        expect(res.status).toBe(404);
    });
});

describe('GET /api/metrics/query - access and validation', () => {
    const buildQuery = (overrides = {}) => {
        const stepMs = 5 * 60 * 1000;
        const to = new Date(Math.floor(Date.now() / stepMs) * stepMs);
        const from = new Date(to.getTime() - 60 * 60 * 1000);

        return new URLSearchParams({
            host_ids: String(hostA),
            from: from.toISOString(),
            to: to.toISOString(),
            step: '5m',
            agg: 'avg',
            ...overrides
        }).toString();
    };

    test('rejects a request without a token', async () => {
        const res = await request(app)
            .get('/api/metrics/query?' + buildQuery());

        expect(res.status).toBe(401);
    });

    test.each(['host_ids', 'from', 'to', 'step', 'agg'])(
        'returns 400 when %s is missing', async (parameter) => {
            const params = new URLSearchParams(buildQuery());
            params.delete(parameter);

            const res = await request(app)
                .get('/api/metrics/query?' + params.toString())
                .set(authHeader(userA.token));

            expect(res.status).toBe(400);
        }
    );

    test.each([
        ['malformed host list', { host_ids: `${hostA},abc` }],
        ['zero host ID', { host_ids: '0' }],
        ['decimal host ID', { host_ids: '1.5' }],
        ['invalid from timestamp', { from: 'not-a-date' }],
        ['invalid to timestamp', { to: 'not-a-date' }],
        ['future to timestamp', {
            to: new Date(Date.now() + 60 * 1000).toISOString()
        }],
        ['from equal to to', (() => {
            const value = new Date().toISOString();
            return { from: value, to: value };
        })()],
        ['unsupported step', { step: 'banana' }],
        ['unsupported aggregation', { agg: 'median' }]
    ])('returns 400 for %s', async (_label, overrides) => {
        const res = await request(app)
            .get('/api/metrics/query?' + buildQuery(overrides))
            .set(authHeader(userA.token));

        expect(res.status).toBe(400);
    });

    test('rejects a query starting beyond the hourly retention limit even when its window is exactly 90 days', async () => {
        const dayMs = 24 * 60 * 60 * 1000;
        const hourMs = 60 * 60 * 1000;
        const now = Date.now();

        const to = new Date(Math.floor(now / hourMs) * hourMs);
        const from = new Date(
            to.getTime() - 90 * dayMs
        );

        const res = await request(app)
            .get('/api/metrics/query?' + new URLSearchParams({
                host_ids: String(hostA),
                from: from.toISOString(),
                to: to.toISOString(),
                step: '1h',
                agg: 'avg'
            }).toString())
            .set(authHeader(userA.token));

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/retention limit/i);
    });
    test('rejects a query window longer than 90 days', async () => {
        const to = new Date();
        const from = new Date(to.getTime() - 91 * 24 * 60 * 60 * 1000);

        const res = await request(app)
            .get('/api/metrics/query?' + new URLSearchParams({
                host_ids: String(hostA),
                from: from.toISOString(),
                to: to.toISOString(),
                step: '1h',
                agg: 'avg'
            }).toString())
            .set(authHeader(userA.token));

        expect(res.status).toBe(400);
    });

    test('rejects the entire multi-host request if any host belongs to another user', async () => {
        const foreignHost = await registerHost(userB.token, 'metrics-foreign-host');

        const res = await request(app)
            .get('/api/metrics/query?' + buildQuery({
                host_ids: `${hostA},${foreignHost}`
            }))
            .set(authHeader(userA.token));

        expect(res.status).toBe(404);
        expect(res.body.data).toBeUndefined();
    });

    test('returns query metadata and an empty data array for a valid empty query', async () => {
        const res = await request(app)
            .get('/api/metrics/query?' + buildQuery())
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body).toEqual(expect.objectContaining({
            step: '5m',
            agg: 'avg',
            data: []
        }));
        expect(res.body.from).toBeDefined();
        expect(res.body.to).toBeDefined();
    });

    test('returns 413 when a metrics query exceeds the row limit', async () => {
        const fetchSpy = jest.spyOn(metricsQueryService, 'fetchMetricQuery');
        fetchSpy.mockResolvedValue(
            Array(metricsQueryService.MAX_QUERY_ROWS + 1).fill({})
        );

        try {
            const res = await request(app)
                .get('/api/metrics/query?' + buildQuery())
                .set(authHeader(userA.token));

            expect(res.status).toBe(413);
            expect(res.body.error).toMatch(/10,000 rows/i);
        } finally {
            fetchSpy.mockRestore();
        }
    });
    test('allows a mixed-source query to end on the latest minute boundary', async () => {
        const hourMs = 60 * 60 * 1000;
        const minuteMs = 60 * 1000;
        const now = Date.now();

        const from = new Date(
            Math.floor((now - 10 * 24 * hourMs) / hourMs) * hourMs
        );
        const to = new Date(
            Math.floor(now / minuteMs) * minuteMs
        );

        const res = await request(app)
            .get('/api/metrics/query?' + buildQuery({
                from: from.toISOString(),
                to: to.toISOString(),
                step: '1h'
            }))
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual(expect.any(Array));
    });
    test('rejects misaligned 5-minute rollup boundaries', async () => {
        const stepMs = 5 * 60 * 1000;
        const to = new Date(Math.floor(Date.now() / stepMs) * stepMs);
        const from = new Date(to.getTime() - 4 * 24 * 60 * 60 * 1000 + 60 * 1000);

        const res = await request(app)
            .get('/api/metrics/query?' + buildQuery({
                from: from.toISOString(),
                to: to.toISOString(),
                step: '5m'
            }))
            .set(authHeader(userA.token));

        expect(res.status).toBe(400);
    });

    test('rejects misaligned hourly rollup boundaries', async () => {
        const hourMs = 60 * 60 * 1000;
        const to = new Date(Math.floor(Date.now() / hourMs) * hourMs);
        const from = new Date(to.getTime() - 10 * 24 * 60 * 60 * 1000 + 5 * 60 * 1000);

        const res = await request(app)
            .get('/api/metrics/query?' + buildQuery({
                from: from.toISOString(),
                to: to.toISOString(),
                step: '1h'
            }))
            .set(authHeader(userA.token));

        expect(res.status).toBe(400);
    });
    test('aggregates raw metrics using the one-minute average', async () => {
        const minuteMs = 60 * 1000;
        const fromMs = Math.floor(Date.now() / minuteMs) * minuteMs - 2 * minuteMs;
        const from = new Date(fromMs);
        const to = new Date(fromMs + minuteMs);

        const samples = [
            { cpu: 10, memory: 20, disk: 30, netIn: 100, netOut: 200 },
            { cpu: 20, memory: 30, disk: 40, netIn: 200, netOut: 300 },
            { cpu: 30, memory: 40, disk: 50, netIn: 300, netOut: 400 },
            { cpu: 40, memory: 50, disk: 60, netIn: 400, netOut: 500 }
        ];

        for (const [index, values] of samples.entries()) {
            const timestamp = new Date(fromMs + (index + 1) * 10000);
            await insertRawAt(hostA, timestamp.toISOString(), values);
        }

        const query = new URLSearchParams({
            host_ids: String(hostA),
            from: from.toISOString(),
            to: to.toISOString(),
            step: '1m',
            agg: 'avg'
        });

        const res = await request(app)
            .get('/api/metrics/query?' + query.toString())
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toEqual(expect.objectContaining({
            host_id: hostA,
            timestamp: from.toISOString(),
            cpu_usage: 25,
            memory_usage: 35,
            disk_usage: 45,
            network_in: 250,
            network_out: 350
        }));
    });

    test('aggregates raw metrics using the one-minute minimum', async () => {
        const minuteMs = 60 * 1000;
        const fromMs = Math.floor(Date.now() / minuteMs) * minuteMs - 2 * minuteMs;
        const from = new Date(fromMs);
        const to = new Date(fromMs + minuteMs);

        const samples = [
            { cpu: 10, memory: 20, disk: 30, netIn: 100, netOut: 200 },
            { cpu: 20, memory: 30, disk: 40, netIn: 200, netOut: 300 },
            { cpu: 30, memory: 40, disk: 50, netIn: 300, netOut: 400 },
            { cpu: 40, memory: 50, disk: 60, netIn: 400, netOut: 500 }
        ];

        for (const [index, values] of samples.entries()) {
            const timestamp = new Date(fromMs + (index + 1) * 10000);
            await insertRawAt(hostA, timestamp.toISOString(), values);
        }

        const query = new URLSearchParams({
            host_ids: String(hostA),
            from: from.toISOString(),
            to: to.toISOString(),
            step: '1m',
            agg: 'min'
        });

        const res = await request(app)
            .get('/api/metrics/query?' + query.toString())
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toEqual(expect.objectContaining({
            host_id: hostA,
            timestamp: from.toISOString(),
            cpu_usage: 10,
            memory_usage: 20,
            disk_usage: 30,
            network_in: 100,
            network_out: 200
        }));
    });
    test('aggregates raw metrics using the one-minute maximum', async () => {
        const minuteMs = 60 * 1000;
        const fromMs = Math.floor(Date.now() / minuteMs) * minuteMs - 2 * minuteMs;
        const from = new Date(fromMs);
        const to = new Date(fromMs + minuteMs);

        const samples = [
            { cpu: 10, memory: 20, disk: 30, netIn: 100, netOut: 200 },
            { cpu: 20, memory: 30, disk: 40, netIn: 200, netOut: 300 },
            { cpu: 30, memory: 40, disk: 50, netIn: 300, netOut: 400 },
            { cpu: 40, memory: 50, disk: 60, netIn: 400, netOut: 500 }
        ];

        for (const [index, values] of samples.entries()) {
            const timestamp = new Date(fromMs + (index + 1) * 10000);
            await insertRawAt(hostA, timestamp.toISOString(), values);
        }

        const query = new URLSearchParams({
            host_ids: String(hostA),
            from: from.toISOString(),
            to: to.toISOString(),
            step: '1m',
            agg: 'max'
        });

        const res = await request(app)
            .get('/api/metrics/query?' + query.toString())
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toEqual(expect.objectContaining({
            host_id: hostA,
            timestamp: from.toISOString(),
            cpu_usage: 40,
            memory_usage: 50,
            disk_usage: 60,
            network_in: 400,
            network_out: 500
        }));
    });
    test('calculates the one-minute 95th percentile from raw metrics', async () => {
        const minuteMs = 60 * 1000;
        const fromMs = Math.floor(Date.now() / minuteMs) * minuteMs - 2 * minuteMs;
        const from = new Date(fromMs);
        const to = new Date(fromMs + minuteMs);

        const samples = [
            { cpu: 10, memory: 20, disk: 30, netIn: 100, netOut: 200 },
            { cpu: 20, memory: 30, disk: 40, netIn: 200, netOut: 300 },
            { cpu: 30, memory: 40, disk: 50, netIn: 300, netOut: 400 },
            { cpu: 40, memory: 50, disk: 60, netIn: 400, netOut: 500 }
        ];

        for (const [index, values] of samples.entries()) {
            const timestamp = new Date(fromMs + (index + 1) * 10000);
            await insertRawAt(hostA, timestamp.toISOString(), values);
        }

        const query = new URLSearchParams({
            host_ids: String(hostA),
            from: from.toISOString(),
            to: to.toISOString(),
            step: '1m',
            agg: 'p95'
        });

        const res = await request(app)
            .get('/api/metrics/query?' + query.toString())
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toEqual(expect.objectContaining({
            host_id: hostA,
            timestamp: from.toISOString(),
            cpu_usage: 38.5,
            memory_usage: 48.5,
            disk_usage: 58.5,
            network_in: 385,
            network_out: 485
        }));
    });

    test('rate limits metrics queries independently per authenticated user', async () => {
        const limitedUser = await createUser();
        const otherUser = await createUser();

        let lastResponse;

        for (let i = 0; i < 61; i++) {
            lastResponse = await request(app)
                .get('/api/metrics/query')
                .set(authHeader(limitedUser.token));
        }

        expect(lastResponse.status).toBe(429);
        expect(lastResponse.body.message).toMatch(/too many metrics queries/i);

        const otherUserResponse = await request(app)
            .get('/api/metrics/query')
            .set(authHeader(otherUser.token));

        expect(otherUserResponse.status).toBe(400);
    });
});
// ===== Step 3: min/max on rollup ranges =====
describe('GET /api/metrics - raw ranges carry no min/max', () => {
    test('raw ranges have no min/max fields', async () => {
        await insertRaw(hostA, 10, 33);

        const res = await request(app)
            .get(`/api/metrics?host_id=${hostA}&range=5m`)
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].cpu_usage).toBe(33);
        expect(res.body[0]).not.toHaveProperty('cpu_usage_min');
        expect(res.body[0]).not.toHaveProperty('cpu_usage_max');
    });
});
// ===== end Step 3 =====
// ===== Gap 5: query API aggregation on rollup sources =====
describe('GET /api/metrics/query - rollup aggregation', () => {
    async function insertQueryRollup(table, hostId, bucketStart, sampleCount, values) {
        await pool.query(
            `INSERT INTO ${table}
                (host_id, bucket_start,
                 cpu_usage_avg, cpu_usage_min, cpu_usage_max,
                 memory_usage_avg, memory_usage_min, memory_usage_max,
                 disk_usage_avg, disk_usage_min, disk_usage_max,
                 network_in_avg, network_in_min, network_in_max,
                 network_out_avg, network_out_min, network_out_max,
                 sample_count)
             VALUES (
                 $1, $2::timestamptz,
                 $3, $4, $5,
                 $6, $7, $8,
                 $9, $10, $11,
                 $12, $13, $14,
                 $15, $16, $17,
                 $18
             )`,
            [
                hostId,
                bucketStart,
                values.cpu.avg, values.cpu.min, values.cpu.max,
                values.memory.avg, values.memory.min, values.memory.max,
                values.disk.avg, values.disk.min, values.disk.max,
                values.networkIn.avg, values.networkIn.min, values.networkIn.max,
                values.networkOut.avg, values.networkOut.min, values.networkOut.max,
                sampleCount
            ]
        );
    }

    const firstBucket = {
        cpu: { avg: 10, min: 5, max: 20 },
        memory: { avg: 20, min: 15, max: 30 },
        disk: { avg: 30, min: 25, max: 40 },
        networkIn: { avg: 100, min: 90, max: 200 },
        networkOut: { avg: 200, min: 180, max: 300 }
    };

    const secondBucket = {
        cpu: { avg: 40, min: 35, max: 50 },
        memory: { avg: 50, min: 45, max: 60 },
        disk: { avg: 60, min: 55, max: 70 },
        networkIn: { avg: 400, min: 390, max: 500 },
        networkOut: { avg: 800, min: 780, max: 900 }
    };

    const cases = [
        {
            label: '5-minute rollups',
            table: 'metric_rollups_5m',
            ageDays: 4,
            step: '15m',
            stepMs: 15 * 60 * 1000,
            bucketOffsetMs: 5 * 60 * 1000,
            firstCount: 2,
            secondCount: 8,
            averages: {
                cpu_usage: 34,
                memory_usage: 44,
                disk_usage: 54,
                network_in: 340,
                network_out: 680
            }
        },
        {
            label: 'hourly rollups',
            table: 'metric_rollups_1h',
            ageDays: 10,
            step: '6h',
            stepMs: 6 * 60 * 60 * 1000,
            bucketOffsetMs: 60 * 60 * 1000,
            firstCount: 3,
            secondCount: 7,
            averages: {
                cpu_usage: 31,
                memory_usage: 41,
                disk_usage: 51,
                network_in: 310,
                network_out: 620
            }
        }
    ];

    test.each(cases)('$label calculate sample-count-weighted averages', async (config) => {
        const fromMs = Math.floor(
            (Date.now() - config.ageDays * 24 * 60 * 60 * 1000) / config.stepMs
        ) * config.stepMs;

        const from = new Date(fromMs);
        const secondTimestamp = new Date(fromMs + config.bucketOffsetMs);
        const to = new Date(fromMs + config.stepMs);

        await insertQueryRollup(
            config.table, hostA, from.toISOString(),
            config.firstCount, firstBucket
        );
        await insertQueryRollup(
            config.table, hostA, secondTimestamp.toISOString(),
            config.secondCount, secondBucket
        );

        const query = new URLSearchParams({
            host_ids: String(hostA),
            from: from.toISOString(),
            to: to.toISOString(),
            step: config.step,
            agg: 'avg'
        });

        const res = await request(app)
            .get('/api/metrics/query?' + query.toString())
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toEqual(expect.objectContaining({
            host_id: hostA,
            timestamp: from.toISOString(),
            ...config.averages
        }));
    });

    test.each(cases)('$label calculate minimum values from bucket minima', async (config) => {
        const fromMs = Math.floor(
            (Date.now() - config.ageDays * 24 * 60 * 60 * 1000) / config.stepMs
        ) * config.stepMs;

        const from = new Date(fromMs);
        const secondTimestamp = new Date(fromMs + config.bucketOffsetMs);
        const to = new Date(fromMs + config.stepMs);

        await insertQueryRollup(
            config.table, hostA, from.toISOString(),
            config.firstCount, firstBucket
        );
        await insertQueryRollup(
            config.table, hostA, secondTimestamp.toISOString(),
            config.secondCount, secondBucket
        );

        const query = new URLSearchParams({
            host_ids: String(hostA),
            from: from.toISOString(),
            to: to.toISOString(),
            step: config.step,
            agg: 'min'
        });

        const res = await request(app)
            .get('/api/metrics/query?' + query.toString())
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toEqual(expect.objectContaining({
            host_id: hostA,
            timestamp: from.toISOString(),
            cpu_usage: 5,
            memory_usage: 15,
            disk_usage: 25,
            network_in: 90,
            network_out: 180
        }));
    });

    test.each(cases)('$label calculate maximum values from bucket maxima', async (config) => {
        const fromMs = Math.floor(
            (Date.now() - config.ageDays * 24 * 60 * 60 * 1000) / config.stepMs
        ) * config.stepMs;

        const from = new Date(fromMs);
        const secondTimestamp = new Date(fromMs + config.bucketOffsetMs);
        const to = new Date(fromMs + config.stepMs);

        await insertQueryRollup(
            config.table, hostA, from.toISOString(),
            config.firstCount, firstBucket
        );
        await insertQueryRollup(
            config.table, hostA, secondTimestamp.toISOString(),
            config.secondCount, secondBucket
        );

        const query = new URLSearchParams({
            host_ids: String(hostA),
            from: from.toISOString(),
            to: to.toISOString(),
            step: config.step,
            agg: 'max'
        });

        const res = await request(app)
            .get('/api/metrics/query?' + query.toString())
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toEqual(expect.objectContaining({
            host_id: hostA,
            timestamp: from.toISOString(),
            cpu_usage: 50,
            memory_usage: 60,
            disk_usage: 70,
            network_in: 500,
            network_out: 900
        }));
    });
    test('combines hourly, 5-minute, and raw sources in one query', async () => {
        const hourMs = 60 * 60 * 1000;
        const toMs = Math.floor(Date.now() / hourMs) * hourMs;
        const fromMs = toMs - 12 * 24 * hourMs;

        const from = new Date(fromMs);
        const to = new Date(toMs);
        const hourlyTimestamp = new Date(fromMs + hourMs);
        const fiveMinuteTimestamp = new Date(toMs - 5 * 24 * hourMs);
        const rawTimestamp = new Date(toMs - 24 * hourMs);

        await insertQueryRollup(
            'metric_rollups_1h',
            hostA,
            hourlyTimestamp.toISOString(),
            2,
            firstBucket
        );

        await insertQueryRollup(
            'metric_rollups_5m',
            hostA,
            fiveMinuteTimestamp.toISOString(),
            4,
            secondBucket
        );

        await insertRawAt(hostA, rawTimestamp.toISOString(), {
            cpu: 70,
            memory: 71,
            disk: 72,
            netIn: 730,
            netOut: 740
        });

        const query = new URLSearchParams({
            host_ids: String(hostA),
            from: from.toISOString(),
            to: to.toISOString(),
            step: '1h',
            agg: 'avg'
        });

        const res = await request(app)
            .get('/api/metrics/query?' + query.toString())
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(3);

        const pointsByTimestamp = new Map(
            res.body.data.map(point => [
                new Date(point.timestamp).getTime(),
                point
            ])
        );

        expect(pointsByTimestamp.size).toBe(3);

        expect(pointsByTimestamp.get(hourlyTimestamp.getTime())).toEqual(
            expect.objectContaining({
                host_id: hostA,
                cpu_usage: 10,
                memory_usage: 20,
                disk_usage: 30,
                network_in: 100,
                network_out: 200
            })
        );

        expect(pointsByTimestamp.get(fiveMinuteTimestamp.getTime())).toEqual(
            expect.objectContaining({
                host_id: hostA,
                cpu_usage: 40,
                memory_usage: 50,
                disk_usage: 60,
                network_in: 400,
                network_out: 800
            })
        );

        expect(pointsByTimestamp.get(rawTimestamp.getTime())).toEqual(
            expect.objectContaining({
                host_id: hostA,
                cpu_usage: 70,
                memory_usage: 71,
                disk_usage: 72,
                network_in: 730,
                network_out: 740
            })
        );
    });
    test('splits exact retention cutovers into adjacent non-overlapping source ranges', () => {
        const now = Date.UTC(2026, 0, 15, 12, 34, 56);
        const dayMs = 24 * 60 * 60 * 1000;
        const fiveMinuteMs = 5 * 60 * 1000;
        const hourMs = 60 * 60 * 1000;

        const rawCutover = Math.ceil(
            (now - RAW_RETENTION_DAYS * dayMs) / fiveMinuteMs
        ) * fiveMinuteMs;

        const hourlyCutover = Math.ceil(
            (now - ROLLUP_5M_RETENTION_DAYS * dayMs) / hourMs
        ) * hourMs;

        const from = new Date(hourlyCutover - hourMs);
        const to = new Date(rawCutover + fiveMinuteMs);

        const segments = metricsQueryService.getQuerySources(from, to, now);

        expect(segments).toHaveLength(3);
        expect(segments.map(segment => segment.source.type)).toEqual([
            '1h',
            '5m',
            'raw'
        ]);

        expect(segments[0].from.getTime()).toBe(from.getTime());
        expect(segments[0].to.getTime()).toBe(hourlyCutover);

        expect(segments[1].from.getTime()).toBe(hourlyCutover);
        expect(segments[1].to.getTime()).toBe(rawCutover);

        expect(segments[2].from.getTime()).toBe(rawCutover);
        expect(segments[2].to.getTime()).toBe(to.getTime());

        expect(segments[0].to.getTime()).toBe(segments[1].from.getTime());
        expect(segments[1].to.getTime()).toBe(segments[2].from.getTime());
    });
});
// ===== End Gap 5 rollup aggregation tests =====

describe('GET /api/metrics/rollup-health - admin access', () => {
    const originalAdminIds = process.env.PULSEIQ_ADMIN_USER_IDS;

    afterEach(() => {
        if (originalAdminIds === undefined) {
            delete process.env.PULSEIQ_ADMIN_USER_IDS;
        } else {
            process.env.PULSEIQ_ADMIN_USER_IDS = originalAdminIds;
        }
    });

    async function getUserId(user) {
        const result = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [user.email]
        );

        expect(result.rows).toHaveLength(1);
        return String(result.rows[0].id);
    }

    test('rejects requests without authentication', async () => {
        const res = await request(app)
            .get('/api/metrics/rollup-health');

        expect(res.status).toBe(401);
    });

    test('denies authenticated users when no admin IDs are configured', async () => {
        delete process.env.PULSEIQ_ADMIN_USER_IDS;

        const res = await request(app)
            .get('/api/metrics/rollup-health')
            .set(authHeader(userA.token));

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: 'Forbidden' });
    });

    test('denies authenticated users who are not in the admin allowlist', async () => {
        const userBId = await getUserId(userB);
        process.env.PULSEIQ_ADMIN_USER_IDS = userBId;

        const res = await request(app)
            .get('/api/metrics/rollup-health')
            .set(authHeader(userA.token));

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: 'Forbidden' });
    });

    test('allows an authenticated user whose ID is in the admin allowlist', async () => {
        const userAId = await getUserId(userA);
        process.env.PULSEIQ_ADMIN_USER_IDS = userAId;

        const res = await request(app)
            .get('/api/metrics/rollup-health')
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('checkedAt');
        expect(res.body).toHaveProperty('jobs');
        expect(Object.keys(res.body.jobs)).toEqual(
            expect.arrayContaining(['5m', '1h', 'cleanup'])
        );
    });
});


describe('GET /api/metrics/custom - access and validation', () => {
    const buildQuery = (overrides = {}) => {
        const to = new Date(Date.now() - 1000);
        const from = new Date(to.getTime() - 60 * 60 * 1000);

        return new URLSearchParams({
            host_id: String(hostA),
            metric_name: 'disk.usage',
            from: from.toISOString(),
            to: to.toISOString(),
            step: '5m',
            agg: 'avg',
            ...overrides
        }).toString();
    };

    test('rejects a request without a token', async () => {
        const res = await request(app)
            .get('/api/metrics/custom?' + buildQuery());

        expect(res.status).toBe(401);
    });

    test.each([
        'host_id',
        'metric_name',
        'from',
        'to',
        'step',
        'agg'
    ])('returns 400 when %s is missing', async (parameter) => {
        const params = new URLSearchParams(buildQuery());
        params.delete(parameter);

        const res = await request(app)
            .get('/api/metrics/custom?' + params.toString())
            .set(authHeader(userA.token));

        expect(res.status).toBe(400);
    });

    test.each([
        ['invalid host ID', { host_id: '1.5' }],
        ['invalid metric name', { metric_name: 'disk usage; DROP TABLE' }],
        ['invalid calendar date', { from: '2026-02-30T10:00:00.000Z' }],
        ['invalid timestamp', { to: 'not-a-date' }],
        ['future end timestamp', {
            to: new Date(Date.now() + 60 * 1000).toISOString()
        }],
        ['unsupported step', { step: 'banana' }],
        ['unsupported aggregation', { agg: 'median' }]
    ])('returns 400 for %s', async (_label, overrides) => {
        const res = await request(app)
            .get('/api/metrics/custom?' + buildQuery(overrides))
            .set(authHeader(userA.token));

        expect(res.status).toBe(400);
    });

    test('rejects a query outside custom metric retention', async () => {
        const to = new Date(Date.now() - 1000);
        const from = new Date(
            to.getTime() - (RAW_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000
        );

        const res = await request(app)
            .get('/api/metrics/custom?' + buildQuery({
                from: from.toISOString()
            }))
            .set(authHeader(userA.token));

        expect(res.status).toBe(400);
    });

    test('does not allow access to another user host', async () => {
        const foreignHost = await registerHost(
            userB.token,
            'custom-metrics-foreign-host'
        );

        const res = await request(app)
            .get('/api/metrics/custom?' + buildQuery({
                host_id: String(foreignHost)
            }))
            .set(authHeader(userA.token));

        expect(res.status).toBe(404);
    });

    test('returns an empty data array when no matching metrics exist', async () => {
        const res = await request(app)
            .get('/api/metrics/custom?' + buildQuery())
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
    });

    test('aggregates matching custom metric samples', async () => {
        const sampleId1 = '11111111-1111-4111-8111-111111111111';
        const sampleId2 = '22222222-2222-4222-8222-222222222222';

        await pool.query(
            `INSERT INTO custom_metrics
                (host_id, sample_id, metric_name, value, unit, tags, collected_at)
             VALUES
                ($1, $2::uuid, 'disk.usage', 40, 'percent',
                 '{"mount":"/"}'::jsonb, (date_bin('5 minutes', NOW(), TIMESTAMPTZ '1970-01-01 00:00:00+00') - INTERVAL '30 seconds')),
                ($1, $3::uuid, 'disk.usage', 60, 'percent',
                 '{"mount":"/"}'::jsonb, (date_bin('5 minutes', NOW(), TIMESTAMPTZ '1970-01-01 00:00:00+00') - INTERVAL '10 seconds'))`,
            [hostA, sampleId1, sampleId2]
        );

        const res = await request(app)
            .get('/api/metrics/custom?' + buildQuery())
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(Number(res.body.data[0].value)).toBe(50);
        expect(res.body.data[0].sample_count).toBe(2);
        expect(res.body.data[0].tags).toEqual({ mount: '/' });
        expect(res.body.aggregation).toBe('avg');
    });
});


describe('GET /api/metrics/custom/names - access and validation', () => {
    test('rejects a request without authentication', async () => {
        const res = await request(app)
            .get(`/api/metrics/custom/names?host_id=${hostA}`);

        expect(res.status).toBe(401);
    });

    test.each([
        ['missing', ''],
        ['non-numeric', 'abc'],
        ['zero', '0'],
        ['negative', '-1'],
        ['decimal', '1.5']
    ])('rejects %s host ID', async (_label, hostId) => {
        const query = hostId
            ? `?host_id=${hostId}`
            : '';

        const res = await request(app)
            .get(`/api/metrics/custom/names${query}`)
            .set(authHeader(userA.token));

        expect(res.status).toBe(400);
    });

    test('does not expose metric names belonging to another user host', async () => {
        const foreignHost = await registerHost(
            userB.token,
            'custom-names-foreign-host'
        );

        const res = await request(app)
            .get(`/api/metrics/custom/names?host_id=${foreignHost}`)
            .set(authHeader(userA.token));

        expect(res.status).toBe(404);
    });

    test('returns an empty metrics array when the host has no custom metrics', async () => {
        const res = await request(app)
            .get(`/api/metrics/custom/names?host_id=${hostA}`)
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body.host_id).toBe(hostA);
        expect(res.body.metrics).toEqual([]);
    });

    test('returns distinct custom metric names, units and sample counts', async () => {
        const sampleIds = [
            '33333333-3333-4333-8333-333333333333',
            '44444444-4444-4444-8444-444444444444',
            '55555555-5555-4555-8555-555555555555'
        ];

        await pool.query(
            `INSERT INTO custom_metrics
                (host_id, sample_id, metric_name, value, unit, tags, collected_at)
             VALUES
                ($1, $2::uuid, 'disk.usage', 40, 'percent',
                 '{"mount":"/"}'::jsonb, (date_bin('5 minutes', NOW(), TIMESTAMPTZ '1970-01-01 00:00:00+00') - INTERVAL '30 seconds')),
                ($1, $3::uuid, 'disk.usage', 60, 'percent',
                 '{"mount":"/"}'::jsonb, (date_bin('5 minutes', NOW(), TIMESTAMPTZ '1970-01-01 00:00:00+00') - INTERVAL '10 seconds')),
                ($1, $4::uuid, 'system.load', 1.5, 'load',
                 '{}'::jsonb, NOW() - INTERVAL '30 seconds')`,
            [hostA, ...sampleIds]
        );

        const res = await request(app)
            .get(`/api/metrics/custom/names?host_id=${hostA}`)
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body.host_id).toBe(hostA);
        expect(res.body.metrics).toHaveLength(2);

        expect(res.body.metrics).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    metric_name: 'disk.usage',
                    unit: 'percent',
                    sample_count: 2
                }),
                expect.objectContaining({
                    metric_name: 'system.load',
                    unit: 'load',
                    sample_count: 1
                })
            ])
        );
    });
});

