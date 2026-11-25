// Runs recomputeBaselines and detectHourlyAnomalies against the real test
// database. The unit tests in baseline.service.test.js mock the client, so
// they cannot catch SQL mistakes (LATERAL VALUES, the partial unique index
// used by ON CONFLICT, the processed-bucket anti-join).

const {
    pool,
    resetDb,
    createUser,
    request,
    app,
    authHeader
} = require('./helpers');

const {
    recomputeBaselines,
    detectHourlyAnomalies
} = require('../src/services/baseline.service');

async function createHost() {
    const user = await createUser();

    const response = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(user.token))
        .send({ name: `baseline-${Date.now()}-${Math.random()}` });

    expect(response.status).toBe(201);

    return response.body.id;
}

// Inserts one completed hourly bucket, `hoursAgo` hours before the start of
// the current hour (1 = the most recent completed hour).
async function insertBucket(hostId, hoursAgo, cpuAverage) {
    await pool.query(
        `INSERT INTO metric_rollups_1h
            (host_id, bucket_start, cpu_usage_avg, cpu_usage_min, cpu_usage_max, sample_count)
         VALUES
            ($1, date_trunc('hour', NOW()) - make_interval(hours => $2::int), $3, $3, $3, 720)`,
        [hostId, hoursAgo, cpuAverage]
    );
}

// Ordinary hourly averages around 30 with a small spread (about 1.4).
async function seedNormalBuckets(hostId, firstHoursAgo, count = 48) {
    for (let i = 0; i < count; i += 1) {
        await insertBucket(hostId, firstHoursAgo + i, 30 + Math.sin(i) * 2);
    }
}

async function runDetection() {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const summary = await detectHourlyAnomalies(client);
        await client.query('COMMIT');
        return summary;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function anomalyRows(hostId) {
    const result = await pool.query(
        `SELECT metric_name, value, deviation_score
         FROM anomalies WHERE host_id = $1 ORDER BY bucket_start`,
        [hostId]
    );

    return result.rows;
}

afterAll(async () => {
    await pool.end();
});

beforeEach(async () => {
    await resetDb();
});

describe('recomputeBaselines (real database)', () => {
    test('stores a mean, spread and sample count for metrics with enough history', async () => {
        const hostId = await createHost();
        await seedNormalBuckets(hostId, 2, 48);

        await recomputeBaselines();

        const result = await pool.query(
            `SELECT metric_name, mean, stddev, sample_count
             FROM metric_baselines WHERE host_id = $1`,
            [hostId]
        );

        // Only CPU has data; the other four metric columns are NULL.
        expect(result.rows).toHaveLength(1);

        const baseline = result.rows[0];

        expect(baseline.metric_name).toBe('cpu_usage');
        expect(Number(baseline.sample_count)).toBe(48);
        expect(Number(baseline.mean)).toBeGreaterThan(29);
        expect(Number(baseline.mean)).toBeLessThan(31);
        expect(Number(baseline.stddev)).toBeGreaterThan(1);
        expect(Number(baseline.stddev)).toBeLessThan(2);
    });

    test('does not create a baseline with fewer than 12 hourly samples', async () => {
        const hostId = await createHost();
        await seedNormalBuckets(hostId, 2, 11);

        await recomputeBaselines();

        const result = await pool.query(
            'SELECT 1 FROM metric_baselines WHERE host_id = $1',
            [hostId]
        );

        expect(result.rows).toHaveLength(0);
    });

    test('updates the existing baseline instead of adding a second row', async () => {
        const hostId = await createHost();
        await seedNormalBuckets(hostId, 2, 48);

        await recomputeBaselines();
        await recomputeBaselines();

        const result = await pool.query(
            'SELECT COUNT(*)::int AS count FROM metric_baselines WHERE host_id = $1',
            [hostId]
        );

        expect(result.rows[0].count).toBe(1);
    });
});

describe('detectHourlyAnomalies (real database)', () => {
    test('ordinary hourly values create no anomalies', async () => {
        const hostId = await createHost();
        await seedNormalBuckets(hostId, 2, 48);
        await recomputeBaselines();

        const summary = await runDetection();

        expect(summary.detected).toBe(0);
        expect(summary.examined).toBe(48);
        expect(await anomalyRows(hostId)).toHaveLength(0);
    });

    test('one extreme hour creates exactly one anomaly with a high deviation score', async () => {
        const hostId = await createHost();
        await seedNormalBuckets(hostId, 2, 48);
        await recomputeBaselines();
        await insertBucket(hostId, 1, 90);

        const summary = await runDetection();
        const rows = await anomalyRows(hostId);

        expect(summary.detected).toBe(1);
        expect(rows).toHaveLength(1);
        expect(rows[0].metric_name).toBe('cpu_usage');
        expect(Number(rows[0].value)).toBe(90);
        expect(Number(rows[0].deviation_score)).toBeGreaterThan(3);
    });

    test('running detection again does not re-examine or duplicate anything', async () => {
        const hostId = await createHost();
        await seedNormalBuckets(hostId, 2, 48);
        await recomputeBaselines();
        await insertBucket(hostId, 1, 90);

        await runDetection();
        const second = await runDetection();

        expect(second.examined).toBe(0);
        expect(second.detected).toBe(0);
        expect(await anomalyRows(hostId)).toHaveLength(1);
    });

    test('a sustained spike is reported once and the rest is suppressed by the cooldown', async () => {
        const hostId = await createHost();
        await seedNormalBuckets(hostId, 4, 48);
        await recomputeBaselines();

        // Three consecutive extreme hours.
        await insertBucket(hostId, 3, 90);
        await insertBucket(hostId, 2, 91);
        await insertBucket(hostId, 1, 92);

        const summary = await runDetection();

        expect(summary.detected).toBe(1);
        expect(summary.cooldownSuppressed).toBe(2);
        expect(await anomalyRows(hostId)).toHaveLength(1);
    });

    test('a second spike more than six hours later is reported separately', async () => {
        const hostId = await createHost();
        await seedNormalBuckets(hostId, 12, 48);
        await recomputeBaselines();

        await insertBucket(hostId, 10, 90);
        await insertBucket(hostId, 1, 91);

        const summary = await runDetection();

        expect(summary.detected).toBe(2);
        expect(summary.cooldownSuppressed).toBe(0);
        expect(await anomalyRows(hostId)).toHaveLength(2);
    });

    test('the current, still-filling hour is never examined', async () => {
        const hostId = await createHost();
        await seedNormalBuckets(hostId, 2, 48);
        await recomputeBaselines();

        await pool.query(
            `INSERT INTO metric_rollups_1h
                (host_id, bucket_start, cpu_usage_avg, cpu_usage_min, cpu_usage_max, sample_count)
             VALUES ($1, date_trunc('hour', NOW()), 99, 99, 99, 10)`,
            [hostId]
        );

        const summary = await runDetection();

        expect(summary.detected).toBe(0);
        expect(await anomalyRows(hostId)).toHaveLength(0);
    });
});