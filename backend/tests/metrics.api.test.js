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
    await pool.query('TRUNCATE metrics, metric_rollups_5m, metric_rollups_1h RESTART IDENTITY');
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

describe('GET /api/metrics - rollup ranges', () => {
    test('6h is served from the 5-minute rollups with raw column names', async () => {
        await insertRollup('metric_rollups_5m', hostA, 3, 33);
        await insertRollup('metric_rollups_5m', hostA, 1, 44);
        await insertRollup('metric_rollups_5m', hostA, 8, 88); // older than 6h
        await insertRollup('metric_rollups_5m', hostA2, 1, 99); // other host
        await insertRaw(hostA, 10, 1);                          // raw rows must be ignored

        const res = await request(app)
            .get(`/api/metrics?host_id=${hostA}&range=6h`)
            .set(authHeader(userA.token));

        expect(res.status).toBe(200);
        expect(res.body.map((row) => row.cpu_usage)).toEqual([33, 44]);
        expect(res.body[0]).toEqual(expect.objectContaining({
            host_id: hostA,
            memory_usage: 41,
            disk_usage: 51,
            network_in: 1001,
            network_out: 2001,
            cpu_usage_min: 28,
            cpu_usage_max: 38,
            memory_usage_min: 36,
            memory_usage_max: 46,
            disk_usage_min: 46,
            disk_usage_max: 56,
            network_in_min: 996,
            network_in_max: 1006,
            network_out_min: 1996,
            network_out_max: 2006
        }));
        expect(res.body[0].timestamp).toBeDefined();
    });

    test('24h range keeps rows up to a day old', async () => {
        await insertRollup('metric_rollups_5m', hostA, 20, 20);
        await insertRollup('metric_rollups_5m', hostA, 30, 30);

        const res = await request(app)
            .get(`/api/metrics?host_id=${hostA}&range=24h`)
            .set(authHeader(userA.token));

        expect(res.body.map((row) => row.cpu_usage)).toEqual([20]);
    });

    test('3d, 7d, 30d and 90d are served from the hourly rollups', async () => {
        await insertRollup('metric_rollups_1h', hostA, 24, 24);
        await insertRollup('metric_rollups_1h', hostA, 24 * 5, 50);
        await insertRollup('metric_rollups_1h', hostA, 24 * 9, 90);
        await insertRollup('metric_rollups_1h', hostA, 24 * 20, 20);
        await insertRollup('metric_rollups_1h', hostA, 24 * 40, 40);
        await insertRollup('metric_rollups_1h', hostA, 24 * 80, 80);
        await insertRollup('metric_rollups_1h', hostA, 24 * 95, 95);
        await insertRollup('metric_rollups_5m', hostA, 1, 1); // wrong table, must be ignored

        const threeDays = await request(app)
            .get(`/api/metrics?host_id=${hostA}&range=3d`)
            .set(authHeader(userA.token));
        const sevenDays = await request(app)
            .get(`/api/metrics?host_id=${hostA}&range=7d`)
            .set(authHeader(userA.token));
        const thirtyDays = await request(app)
            .get(`/api/metrics?host_id=${hostA}&range=30d`)
            .set(authHeader(userA.token));
        const ninetyDays = await request(app)
            .get(`/api/metrics?host_id=${hostA}&range=90d`)
            .set(authHeader(userA.token));

        expect(threeDays.body.map((row) => row.cpu_usage)).toEqual([24]);

        expect(threeDays.body[0]).toEqual(expect.objectContaining({
            cpu_usage: 24,
            cpu_usage_min: 19,
            cpu_usage_max: 29,
            memory_usage_min: 36,
            memory_usage_max: 46,
            disk_usage_min: 46,
            disk_usage_max: 56,
            network_in_min: 996,
            network_in_max: 1006,
            network_out_min: 1996,
            network_out_max: 2006
        }));
        expect(sevenDays.body.map((row) => row.cpu_usage)).toEqual([50, 24]);
        expect(thirtyDays.body.map((row) => row.cpu_usage)).toEqual([20, 90, 50, 24]);
        expect(ninetyDays.body.map((row) => row.cpu_usage)).toEqual([80, 40, 20, 90, 50, 24]);
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
    });});
