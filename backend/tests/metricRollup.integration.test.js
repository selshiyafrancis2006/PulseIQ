const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

const {
    rollup5Minute,
    rollup1Hour,
    cleanupRawMetrics
} = require('../src/services/metricRollup.service');

let hostA;
let hostB;

async function registerHost(token, name) {
    const res = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(token))
        .send({ name });

    expect(res.status).toBe(201);
    return res.body.id;
}

// Start (as an ISO string) of the 5-minute bucket that began `bucketsAgo`
// buckets before the current one. Computed in SQL so it matches the service.
async function bucketStart(bucketsAgo) {
    const res = await pool.query(
        `SELECT to_timestamp(floor(extract(epoch FROM NOW()) / 300) * 300
                             - $1::int * 300) AS b`,
        [bucketsAgo]
    );
    return res.rows[0].b;
}

async function insertRawAt(hostId, timestamp, values) {
    await pool.query(
        `INSERT INTO metrics
            (host_id, timestamp, cpu_usage, memory_usage, disk_usage, network_in, network_out)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
            hostId,
            timestamp,
            values.cpu,
            values.memory ?? 50,
            values.disk ?? 60,
            values.netIn ?? 100,
            values.netOut ?? 200
        ]
    );
}

const offset = (date, seconds) => new Date(date.getTime() + seconds * 1000);

const fiveMinuteRows = async (hostId) =>
    (await pool.query(
        'SELECT * FROM metric_rollups_5m WHERE host_id = $1 ORDER BY bucket_start',
        [hostId]
    )).rows;

const hourRows = async (hostId) =>
    (await pool.query(
        'SELECT * FROM metric_rollups_1h WHERE host_id = $1 ORDER BY bucket_start',
        [hostId]
    )).rows;

beforeAll(async () => {
    await resetDb();

    const user = await createUser();
    hostA = await registerHost(user.token, 'rollup-host-a');
    hostB = await registerHost(user.token, 'rollup-host-b');
});

afterAll(async () => {
    await pool.end();
});

beforeEach(async () => {
    await pool.query('TRUNCATE metrics, metric_rollups_5m, metric_rollups_1h RESTART IDENTITY');
});

describe('rollup5Minute', () => {
    test('aggregates raw rows into avg, min, max and a sample count per bucket', async () => {
        const b = await bucketStart(2);

        await insertRawAt(hostA, offset(b, 10), { cpu: 10, memory: 40, netIn: 100 });
        await insertRawAt(hostA, offset(b, 100), { cpu: 30, memory: 60, netIn: 300 });
        await insertRawAt(hostA, offset(b, 200), { cpu: 20, memory: 50, netIn: 200 });

        await rollup5Minute();

        const rows = await fiveMinuteRows(hostA);
        expect(rows).toHaveLength(1);
        expect(new Date(rows[0].bucket_start).getTime()).toBe(b.getTime());
        expect(rows[0]).toEqual(expect.objectContaining({
            cpu_usage_avg: 20,
            cpu_usage_min: 10,
            cpu_usage_max: 30,
            memory_usage_avg: 50,
            memory_usage_min: 40,
            memory_usage_max: 60,
            network_in_avg: 200,
            network_in_min: 100,
            network_in_max: 300,
            sample_count: 3
        }));
    });

    test('splits rows from different 5-minute windows into separate buckets', async () => {
        const first = await bucketStart(2);
        const second = await bucketStart(1);

        await insertRawAt(hostA, offset(first, 30), { cpu: 10 });
        await insertRawAt(hostA, offset(second, 30), { cpu: 90 });

        await rollup5Minute();

        const rows = await fiveMinuteRows(hostA);
        expect(rows.map((row) => row.cpu_usage_avg)).toEqual([10, 90]);
        expect(rows.map((row) => row.sample_count)).toEqual([1, 1]);
    });

    test('keeps hosts separate', async () => {
        const b = await bucketStart(1);

        await insertRawAt(hostA, offset(b, 30), { cpu: 11 });
        await insertRawAt(hostB, offset(b, 30), { cpu: 77 });

        await rollup5Minute();

        expect((await fiveMinuteRows(hostA))[0].cpu_usage_avg).toBe(11);
        expect((await fiveMinuteRows(hostB))[0].cpu_usage_avg).toBe(77);
    });

    test('is idempotent: running it again does not duplicate buckets or double counts', async () => {
        const b = await bucketStart(1);

        await insertRawAt(hostA, offset(b, 10), { cpu: 10 });
        await insertRawAt(hostA, offset(b, 20), { cpu: 30 });

        await rollup5Minute();
        await rollup5Minute();
        await rollup5Minute();

        const rows = await fiveMinuteRows(hostA);
        expect(rows).toHaveLength(1);
        expect(rows[0].sample_count).toBe(2);
        expect(rows[0].cpu_usage_avg).toBe(20);
    });

    test('refines a bucket when more raw rows arrive after the first run', async () => {
        const b = await bucketStart(1);

        await insertRawAt(hostA, offset(b, 10), { cpu: 10 });
        await rollup5Minute();
        expect((await fiveMinuteRows(hostA))[0].sample_count).toBe(1);

        await insertRawAt(hostA, offset(b, 20), { cpu: 50 });
        await rollup5Minute();

        const rows = await fiveMinuteRows(hostA);
        expect(rows).toHaveLength(1);
        expect(rows[0].sample_count).toBe(2);
        expect(rows[0].cpu_usage_avg).toBe(30);
        expect(rows[0].cpu_usage_max).toBe(50);
    });

    test('recovers raw metric buckets older than the 15-minute lookback', async () => {
        const missedBucket = await bucketStart(12);

        await insertRawAt(hostA, offset(missedBucket, 30), { cpu: 25 });
        await insertRawAt(hostA, offset(missedBucket, 90), { cpu: 75 });

        await rollup5Minute();

        const rows = await fiveMinuteRows(hostA);

        expect(rows).toHaveLength(1);
        expect(new Date(rows[0].bucket_start).getTime())
            .toBe(missedBucket.getTime());
        expect(rows[0].cpu_usage_avg).toBe(50);
        expect(rows[0].sample_count).toBe(2);

        // A late sample in this old bucket must refine its existing rollup.
        await insertRawAt(hostA, offset(missedBucket, 150), { cpu: 50 });
        await rollup5Minute();

        const refinedRows = await fiveMinuteRows(hostA);
        expect(refinedRows).toHaveLength(1);
        expect(refinedRows[0].sample_count).toBe(3);
        expect(refinedRows[0].cpu_usage_avg).toBe(50);
        expect(refinedRows[0].cpu_usage_max).toBe(75);
    });
    test('places delayed samples into their original collection-time bucket', async () => {
        const recentBucket = await bucketStart(1);

        await insertRawAt(hostA, offset(recentBucket, 30), { cpu: 10 });
        await rollup5Minute();

        const collectedAt = new Date(Date.now() - 90 * 60 * 1000);

        await pool.query(
            `INSERT INTO metrics
                (host_id, timestamp, collected_at, cpu_usage, memory_usage, disk_usage, network_in, network_out)
             VALUES ($1, NOW(), $2, 75, 50, 60, 100, 200)`,
            [hostA, collectedAt]
        );

        const expectedBucket = await pool.query(
            `SELECT to_timestamp(
                floor(extract(epoch FROM $1::timestamptz) / 300) * 300
             ) AS bucket_start`,
            [collectedAt]
        );

        await rollup5Minute();

        const rows = await fiveMinuteRows(hostA);
        const delayedRow = rows.find(
            (row) => new Date(row.bucket_start).getTime() ===
                new Date(expectedBucket.rows[0].bucket_start).getTime()
        );

        expect(delayedRow).toEqual(expect.objectContaining({
            cpu_usage_avg: 75,
            sample_count: 1
        }));
    });
    test('creates nothing when there are no raw rows', async () => {
        await rollup5Minute();

        expect(await fiveMinuteRows(hostA)).toEqual([]);
    });
});

describe('rollup1Hour', () => {
    async function insertFiveMinute(hostId, bucket, { cpuAvg, cpuMin, cpuMax, count }) {
        await pool.query(
            `INSERT INTO metric_rollups_5m
                (host_id, bucket_start,
                 cpu_usage_avg, cpu_usage_min, cpu_usage_max,
                 memory_usage_avg, memory_usage_min, memory_usage_max,
                 disk_usage_avg, disk_usage_min, disk_usage_max,
                 network_in_avg, network_in_min, network_in_max,
                 network_out_avg, network_out_min, network_out_max,
                 sample_count)
             VALUES ($1, $2, $3, $4, $5,
                     $3, $4, $5, $3, $4, $5, $3, $4, $5, $3, $4, $5, $6)`,
            [hostId, bucket, cpuAvg, cpuMin, cpuMax, count]
        );
    }

    async function hourStart(hoursAgo) {
        const res = await pool.query(
            `SELECT date_trunc('hour', NOW(), 'UTC') - $1::int * INTERVAL '1 hour' AS h`,
            [hoursAgo]
        );
        return res.rows[0].h;
    }

    test('weights each 5-minute average by its sample count', async () => {
        const h = await hourStart(2);

        // 1 sample averaging 10 and 3 samples averaging 40 -> (10 + 120) / 4 = 32.5.
        // A plain average of the averages would wrongly give 25.
        await insertFiveMinute(hostA, offset(h, 0), { cpuAvg: 10, cpuMin: 10, cpuMax: 10, count: 1 });
        await insertFiveMinute(hostA, offset(h, 300), { cpuAvg: 40, cpuMin: 35, cpuMax: 90, count: 3 });

        await rollup1Hour();

        const rows = await hourRows(hostA);
        expect(rows).toHaveLength(1);
        expect(new Date(rows[0].bucket_start).getTime()).toBe(h.getTime());
        expect(rows[0].cpu_usage_avg).toBeCloseTo(32.5, 5);
        expect(rows[0].cpu_usage_min).toBe(10);
        expect(rows[0].cpu_usage_max).toBe(90);
        expect(rows[0].sample_count).toBe(4);
    });

    test('puts 5-minute buckets of different hours into different hourly rows', async () => {
        const first = await hourStart(3);
        const second = await hourStart(2);

        await insertFiveMinute(hostA, offset(first, 600), { cpuAvg: 20, cpuMin: 20, cpuMax: 20, count: 5 });
        await insertFiveMinute(hostA, offset(second, 600), { cpuAvg: 60, cpuMin: 60, cpuMax: 60, count: 5 });

        await rollup1Hour();

        const rows = await hourRows(hostA);
        expect(rows.map((row) => row.cpu_usage_avg)).toEqual([20, 60]);
    });

    test('keeps hosts separate', async () => {
        const h = await hourStart(2);

        await insertFiveMinute(hostA, offset(h, 0), { cpuAvg: 15, cpuMin: 15, cpuMax: 15, count: 2 });
                await insertFiveMinute(hostB, offset(h, 0), { cpuAvg: 85, cpuMin: 85, cpuMax: 85, count: 2 });

        await rollup1Hour();

        expect((await hourRows(hostA))[0].cpu_usage_avg).toBe(15);
        expect((await hourRows(hostB))[0].cpu_usage_avg).toBe(85);
    });

    test('is idempotent and refines the hour when a new 5-minute bucket appears', async () => {
        const h = await hourStart(1);

        await insertFiveMinute(hostA, offset(h, 0), { cpuAvg: 10, cpuMin: 10, cpuMax: 10, count: 1 });

        await rollup1Hour();
        await rollup1Hour();

        let rows = await hourRows(hostA);
        expect(rows).toHaveLength(1);
        expect(rows[0].sample_count).toBe(1);

        await insertFiveMinute(hostA, offset(h, 300), { cpuAvg: 30, cpuMin: 30, cpuMax: 30, count: 1 });
        await rollup1Hour();

        rows = await hourRows(hostA);
        expect(rows).toHaveLength(1);
        expect(rows[0].sample_count).toBe(2);
        expect(rows[0].cpu_usage_avg).toBe(20);
    });

    test('works end to end from raw rows through both rollup levels', async () => {
        const b = await bucketStart(1);

        await insertRawAt(hostA, offset(b, 10), { cpu: 20 });
        await insertRawAt(hostA, offset(b, 20), { cpu: 40 });

        await rollup5Minute();
        await rollup1Hour();

        const rows = await hourRows(hostA);
        expect(rows).toHaveLength(1);
        expect(rows[0].cpu_usage_avg).toBe(30);
        expect(rows[0].cpu_usage_min).toBe(20);
        expect(rows[0].cpu_usage_max).toBe(40);
        expect(rows[0].sample_count).toBe(2);
    });
});

describe('cleanupRawMetrics', () => {
    test('deletes raw rows older than 3 days and keeps newer ones', async () => {
        const now = Date.now();
        const daysAgo = (days) => new Date(now - days * 24 * 3600 * 1000);

        await insertRawAt(hostA, daysAgo(4), { cpu: 1 });
        await insertRawAt(hostA, daysAgo(3.5), { cpu: 2 });
        await insertRawAt(hostA, daysAgo(2), { cpu: 3 });
        await insertRawAt(hostB, daysAgo(0.1), { cpu: 4 });

        const deleted = await cleanupRawMetrics();

        expect(deleted).toBe(2);

        const left = await pool.query('SELECT cpu_usage FROM metrics ORDER BY cpu_usage');
        expect(left.rows.map((row) => row.cpu_usage)).toEqual([3, 4]);
    });

    test('does not touch the rollup tables', async () => {
        const b = await bucketStart(1);

        await insertRawAt(hostA, offset(b, 10), { cpu: 10 });
        await rollup5Minute();

        await pool.query(`UPDATE metrics SET timestamp = NOW() - INTERVAL '10 days'`);
        await cleanupRawMetrics();

        expect(await fiveMinuteRows(hostA)).toHaveLength(1);
    });
});
