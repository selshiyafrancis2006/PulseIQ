
jest.mock('../../src/config/db', () => ({
    query: jest.fn()
}));

const pool = require('../../src/config/db');
const { cleanupRawMetrics, cleanupHistoricalData, rollup5Minute, rollup1Hour, RAW_RETENTION_DAYS, ANOMALY_BUCKET_RETENTION_DAYS } = require('../../src/services/metricRollup.service');

describe('cleanupRawMetrics', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        pool.query.mockResolvedValue({ rowCount: 0 });
    });

    test('deletes raw metrics older than the configured retention window', async () => {
        const result = await cleanupRawMetrics();

        expect(pool.query).toHaveBeenCalledTimes(1);

        const [sql] = pool.query.mock.calls[0];

        expect(sql).toContain('DELETE FROM metrics');
        expect(sql).toContain('COALESCE(collected_at, timestamp)');
        expect(sql).toContain(`INTERVAL '${RAW_RETENTION_DAYS} days'`);

        expect(result).toBe(0);
    });

    test('returns the number of deleted raw metric rows', async () => {
        pool.query.mockResolvedValueOnce({ rowCount: 12 });

        const result = await cleanupRawMetrics();

        expect(result).toBe(12);
    });

    test('propagates database errors', async () => {
        pool.query.mockRejectedValueOnce(new Error('Database unavailable'));

        await expect(cleanupRawMetrics()).rejects.toThrow('Database unavailable');
    });
});

describe('cleanupHistoricalData', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        pool.query.mockResolvedValue({ rowCount: 0 });
    });

    test('deletes expired rollups, anomalies, and traces using the intended retention windows', async () => {
        const result = await cleanupHistoricalData();

        expect(pool.query).toHaveBeenCalledTimes(7);

        const queries = pool.query.mock.calls.map(([sql]) => sql);

        expect(queries[0]).toContain('DELETE FROM metric_rollups_5m');
        expect(queries[0]).toContain("INTERVAL '8 days'");

        expect(queries[1]).toContain('DELETE FROM metric_rollups_1h');
        expect(queries[1]).toContain("INTERVAL '90 days'");

        expect(queries[2]).toContain('DELETE FROM metric_rollups_5m_generic');
        expect(queries[2]).toContain("INTERVAL '8 days'");

        expect(queries[3]).toContain('DELETE FROM metric_rollups_1h_generic');
        expect(queries[3]).toContain("INTERVAL '90 days'");

        expect(queries[4]).toContain('DELETE FROM anomalies');
        expect(queries[4]).toContain("INTERVAL '30 days'");

        expect(queries[5]).toContain('DELETE FROM anomaly_detection_buckets');
        expect(queries[5]).toContain(`INTERVAL '${ANOMALY_BUCKET_RETENTION_DAYS} days'`);

        expect(queries[6]).toContain('DELETE FROM traces');
        expect(queries[6]).toContain("INTERVAL '7 days'");

        expect(result).toEqual({
            '5-minute rollups': 0,
            'hourly rollups': 0,
            'generic 5-minute rollups': 0,
            'generic hourly rollups': 0,
            anomalies: 0,
            'anomaly detection buckets': 0,
            traces: 0
        });
    });

    test('returns the number of deleted rows for each table', async () => {
        pool.query
            .mockResolvedValueOnce({ rowCount: 5 })
            .mockResolvedValueOnce({ rowCount: 2 })
            .mockResolvedValueOnce({ rowCount: 6 })
            .mockResolvedValueOnce({ rowCount: 8 })
            .mockResolvedValueOnce({ rowCount: 3 })
            .mockResolvedValueOnce({ rowCount: 4 })
            .mockResolvedValueOnce({ rowCount: 7 });

        const result = await cleanupHistoricalData();

        expect(result).toEqual({
            '5-minute rollups': 5,
            'hourly rollups': 2,
            'generic 5-minute rollups': 6,
            'generic hourly rollups': 8,
            anomalies: 3,
            'anomaly detection buckets': 4,
            traces: 7
        });
    });

    test('propagates database errors instead of reporting false success', async () => {
        pool.query.mockRejectedValueOnce(new Error('Database unavailable'));

        await expect(cleanupHistoricalData()).rejects.toThrow('Database unavailable');
    });
});

describe('metric rollup backfill ranges', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        pool.query.mockResolvedValue({ rowCount: 0 });
    });

    test('5-minute backfill uses the requested parameterized range', async () => {
        const bucketMs = 5 * 60 * 1000;
        const toMs = Math.floor(Date.now() / bucketMs) * bucketMs - bucketMs;
        const fromMs = toMs - bucketMs;

        const range = {
            from: new Date(fromMs).toISOString(),
            to: new Date(toMs).toISOString()
        };

        await rollup5Minute(pool, range);

        expect(pool.query).toHaveBeenCalledTimes(2);

        const [sql, params] = pool.query.mock.calls[0];
        const [genericSql, genericParams] = pool.query.mock.calls[1];

        expect(sql).toContain('$1::timestamptz');
        expect(sql).toContain('$2::timestamptz');
        expect(params).toEqual([range.from, range.to]);

        expect(genericSql).toContain('INSERT INTO metric_rollups_5m_generic');
        expect(genericSql).toContain('$1::timestamptz');
        expect(genericSql).toContain('$2::timestamptz');
        expect(genericParams).toEqual([range.from, range.to]);
    });

    test('hourly backfill uses the requested parameterized range', async () => {
        const bucketMs = 60 * 60 * 1000;
        const toMs = Math.floor(Date.now() / bucketMs) * bucketMs - bucketMs;
        const fromMs = toMs - bucketMs;

        const range = {
            from: new Date(fromMs).toISOString(),
            to: new Date(toMs).toISOString()
        };

        await rollup1Hour(pool, range);

        expect(pool.query).toHaveBeenCalledTimes(2);

        const [sql, params] = pool.query.mock.calls[0];
        const [genericSql, genericParams] = pool.query.mock.calls[1];

        expect(sql).toContain('$1::timestamptz');
        expect(sql).toContain('$2::timestamptz');
        expect(params).toEqual([range.from, range.to]);

        expect(genericSql).toContain('INSERT INTO metric_rollups_1h_generic');
        expect(genericSql).toContain('$1::timestamptz');
        expect(genericSql).toContain('$2::timestamptz');
        expect(genericParams).toEqual([range.from, range.to]);
    });

    test('hourly rollup includes the final :55 bucket but excludes the next hour', async () => {
        const hourMs = 60 * 60 * 1000;
        const toMs = Math.floor(Date.now() / hourMs) * hourMs;
        const fromMs = toMs - hourMs;
        const finalBucketMs = fromMs + 55 * 60 * 1000;

        const range = {
            from: new Date(fromMs).toISOString(),
            to: new Date(toMs).toISOString()
        };

        await rollup1Hour(pool, range);

        const [sql, params] = pool.query.mock.calls[0];

        expect(params).toEqual([range.from, range.to]);
        expect(sql).toMatch(/bucket_start\s*>=\s*\$1::timestamptz/);
        expect(sql).toMatch(/bucket_start\s*<\s*\$2::timestamptz/);

        expect(finalBucketMs).toBeGreaterThanOrEqual(Date.parse(params[0]));
        expect(finalBucketMs).toBeLessThan(Date.parse(params[1]));
        expect(toMs).toBe(Date.parse(params[1]));
    });

    test('rejects misaligned 5-minute boundaries without querying the database', async () => {
        const bucketMs = 5 * 60 * 1000;
        const toMs = Math.floor(Date.now() / bucketMs) * bucketMs - bucketMs;

        const range = {
            from: new Date(toMs - bucketMs + 1000).toISOString(),
            to: new Date(toMs).toISOString()
        };

        await expect(rollup5Minute(pool, range))
            .rejects.toThrow('boundaries must align');

        expect(pool.query).not.toHaveBeenCalled();
    });

    test('rejects misaligned hourly boundaries without querying the database', async () => {
        const bucketMs = 60 * 60 * 1000;
        const toMs = Math.floor(Date.now() / bucketMs) * bucketMs - bucketMs;

        const range = {
            from: new Date(toMs - bucketMs + 1000).toISOString(),
            to: new Date(toMs).toISOString()
        };

        await expect(rollup1Hour(pool, range))
            .rejects.toThrow('boundaries must align');

        expect(pool.query).not.toHaveBeenCalled();
    });

    test('rejects ranges older than the retained raw metrics window', async () => {
        const range = {
            from: '2020-01-01T00:00:00.000Z',
            to: '2020-01-01T00:05:00.000Z'
        };

        await expect(rollup5Minute(pool, range))
            .rejects.toThrow('safely retained data window');

        expect(pool.query).not.toHaveBeenCalled();
    });

    test('rejects hourly ranges older than the retained 5-minute rollup window', async () => {
        const range = {
            from: '2020-01-01T00:00:00.000Z',
            to: '2020-01-01T01:00:00.000Z'
        };

        await expect(rollup1Hour(pool, range))
            .rejects.toThrow('safely retained data window');

        expect(pool.query).not.toHaveBeenCalled();
    });
});
