// End-to-end test of the metrics pipeline, nothing mocked:
//   agent queue -> POST /api/agent/metrics -> raw table
//     -> 5-minute and hourly rollups -> GET /api/metrics/query
// Date.now is moved forward to read the rollup tiers (+4d, +9d).

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { app, pool, request, resetDb, createUser, authHeader } = require('./helpers');
const { rollup5Minute, rollup1Hour } = require('../src/services/metricRollup.service');
const { MetricDeliveryQueue } = require('../../agent/metric-delivery-queue');
const { createFileStore } = require('../../agent/metric-queue-store');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

let user;
let hostId;
let apiKey;
let hour; // start (ms) of the previous complete hour
let tempDir;
let dateNowSpy;

// [minutes into the hour, cpu, memory, disk, network_in, network_out]
const SAMPLES = [
    [2, 10, 40, 60, 100, 10],
    [7, 20, 50, 60, 200, 20],
    [57, 60, 70, 60, 600, 60]   // final 5-minute bucket of the hour
];

const buildSample = ([minute, cpu, memory, disk, netIn, netOut]) => ({
    sample_id: crypto.randomUUID(),
    collected_at: new Date(hour + minute * MINUTE).toISOString(),
    cpu_usage: cpu,
    memory_usage: memory,
    disk_usage: disk,
    network_in: netIn,
    network_out: netOut
});

const sendToBackend = async (payload) => {
    const res = await request(app)
        .post('/api/agent/metrics')
        .set('x-api-key', apiKey)
        .send(payload);

    if (res.status >= 400) {
        const error = new Error(`Ingestion rejected the sample: ${res.status}`);
        error.response = { status: res.status };
        throw error;
    }
    return res;
};

const silentLogger = { warn() {}, error() {}, log() {} };

const makeQueue = (options = {}) => new MetricDeliveryQueue({
    send: sendToBackend,
    sleep: async () => {},
    logger: silentLogger,
    ...options
});

const queryApi = (token, { step, agg = 'avg' }) =>
    request(app)
        .get('/api/metrics/query')
        .set(authHeader(token))
        .query({
            host_ids: String(hostId),
            from: new Date(hour).toISOString(),
            to: new Date(hour + HOUR).toISOString(),
            step,
            agg
        });

const advanceClock = (ms) => {
    const realNow = Date.now.bind(Date);
    dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + ms);
};

const restoreClock = () => {
    if (dateNowSpy) {
        dateNowSpy.mockRestore();
        dateNowSpy = null;
    }
};

const rawCount = async () =>
    Number((await pool.query(
        'SELECT COUNT(*) FROM metrics WHERE host_id = $1', [hostId]
    )).rows[0].count);

beforeAll(async () => {
    await resetDb();
    await pool.query('TRUNCATE metrics, metric_rollups_5m, metric_rollups_1h RESTART IDENTITY');

    user = await createUser();

    const hostRes = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(user.token))
        .send({ name: 'e2e-pipeline-host' });

    expect(hostRes.status).toBe(201);
    hostId = hostRes.body.id;
    apiKey = hostRes.body.api_key;

    hour = Math.floor(Date.now() / HOUR) * HOUR - HOUR;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulseiq-e2e-'));
});

afterEach(restoreClock);

afterAll(async () => {
    restoreClock();
    fs.rmSync(tempDir, { recursive: true, force: true });
    await pool.end();
});

describe('metrics pipeline: agent -> ingestion -> rollup -> API', () => {
    test('agent delivers saved and live samples to ingestion exactly once', async () => {
        const [first, second, third] = SAMPLES.map(buildSample);

        // Agent stopped with two samples still on disk, then restarts.
        const queueFile = path.join(tempDir, 'queue.json');
        createFileStore(queueFile, { logger: silentLogger }).save([first, second]);

        const queue = makeQueue({ store: createFileStore(queueFile, { logger: silentLogger }) });
        expect(queue.restoredCount).toBe(2);

        queue.enqueue(third);

        expect(await queue.flush(10000)).toBe(0);
        expect(queue.droppedCount).toBe(0);
        expect(await rawCount()).toBe(3);
        expect(createFileStore(queueFile, { logger: silentLogger }).load()).toEqual([]);

        // Re-sending a sample (retry after a lost response) is a no-op.
        const retry = makeQueue();
        retry.enqueue(first);
        expect(await retry.flush(10000)).toBe(0);
        expect(await rawCount()).toBe(3);

        const stored = await pool.query(
            'SELECT cpu_usage, collected_at FROM metrics WHERE host_id = $1 ORDER BY collected_at',
            [hostId]
        );
        expect(stored.rows.map((r) => Number(r.cpu_usage))).toEqual([10, 20, 60]);
        expect(stored.rows.map((r) => new Date(r.collected_at).getTime()))
            .toEqual(SAMPLES.map(([minute]) => hour + minute * MINUTE));
    });

    test('the API serves the new samples from the raw table', async () => {
        const res = await queryApi(user.token, { step: '1m' });

        expect(res.status).toBe(200);
        const rows = res.body.data;

        expect(rows.map((r) => new Date(r.timestamp).getTime()))
            .toEqual(SAMPLES.map(([minute]) => hour + minute * MINUTE));
        expect(rows.map((r) => Number(r.cpu_usage))).toEqual([10, 20, 60]);
        expect(rows.map((r) => Number(r.network_in))).toEqual([100, 200, 600]);
        expect(rows.every((r) => Number(r.sample_count) === 1)).toBe(true);
    });

    test('rollups keep every sample, including the final 5-minute bucket', async () => {
        await rollup5Minute();
        await rollup1Hour();

        const fiveMinute = (await pool.query(
            'SELECT bucket_start, cpu_usage_avg FROM metric_rollups_5m WHERE host_id = $1 ORDER BY bucket_start',
            [hostId]
        )).rows;

        expect(fiveMinute.map((r) => new Date(r.bucket_start).getTime()))
            .toEqual([hour, hour + 5 * MINUTE, hour + 55 * MINUTE]);
        expect(fiveMinute.map((r) => Number(r.cpu_usage_avg))).toEqual([10, 20, 60]);

        const hourly = (await pool.query(
            `SELECT bucket_start, cpu_usage_avg, cpu_usage_min, cpu_usage_max, network_in_max, sample_count
             FROM metric_rollups_1h WHERE host_id = $1 ORDER BY bucket_start`,
            [hostId]
        )).rows;

        expect(hourly).toHaveLength(1);
        expect(new Date(hourly[0].bucket_start).getTime()).toBe(hour);
        expect(Number(hourly[0].cpu_usage_avg)).toBeCloseTo(30, 5);
        expect(Number(hourly[0].cpu_usage_min)).toBe(10);
        expect(Number(hourly[0].cpu_usage_max)).toBe(60);
        expect(Number(hourly[0].network_in_max)).toBe(600);
        expect(Number(hourly[0].sample_count)).toBe(3);
    });

    test('the API serves the same data from the 5-minute rollups', async () => {
        advanceClock(4 * DAY);

        const res = await queryApi(user.token, { step: '5m' });
        expect(res.status).toBe(200);

        const rows = res.body.data;
        expect(rows.map((r) => new Date(r.timestamp).getTime()))
            .toEqual([hour, hour + 5 * MINUTE, hour + 55 * MINUTE]);
        expect(rows.map((r) => Number(r.cpu_usage))).toEqual([10, 20, 60]);
        expect(rows.map((r) => Number(r.sample_count))).toEqual([1, 1, 1]);
    });

    test('the API serves the same data from the hourly rollups', async () => {
        advanceClock(9 * DAY);

        // The old token is expired on the moved clock, so sign in again.
        const login = await request(app)
            .post('/api/auth/login')
            .send({ email: user.email, password: 'password123' });
        expect(login.status).toBe(200);

        const avg = await queryApi(login.body.token, { step: '1h', agg: 'avg' });
        const max = await queryApi(login.body.token, { step: '1h', agg: 'max' });
        const min = await queryApi(login.body.token, { step: '1h', agg: 'min' });

        expect(avg.status).toBe(200);
        expect(avg.body.data).toHaveLength(1);
        expect(new Date(avg.body.data[0].timestamp).getTime()).toBe(hour);
        expect(Number(avg.body.data[0].cpu_usage)).toBeCloseTo(30, 5);
        expect(Number(avg.body.data[0].sample_count)).toBe(3);
        expect(Number(max.body.data[0].cpu_usage)).toBe(60);
        expect(Number(min.body.data[0].cpu_usage)).toBe(10);
    });
});