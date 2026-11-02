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

async function insertRollup(table, hostId, hoursAgo, cpuAvg) {
    await pool.query(
        `INSERT INTO ${table}
            (host_id, bucket_start,
             cpu_usage_avg, memory_usage_avg, disk_usage_avg,
             network_in_avg, network_out_avg, sample_count)
         VALUES ($1, date_trunc('hour', NOW()) - ($2 || ' hours')::interval,
                 $3, 41, 51, 1001, 2001, 10)`,
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
            network_out: 2001
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