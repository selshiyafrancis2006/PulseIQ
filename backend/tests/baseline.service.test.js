jest.mock('../src/config/db', () => ({
    query: jest.fn()
}));

const { detectHourlyAnomalies } = require('../src/services/baseline.service');

const createClient = (candidateRows = [], cooldownRows = []) => {
    const query = jest.fn()
        .mockResolvedValueOnce({ rows: candidateRows })
        .mockImplementation(async (sql) => {
            if (sql.includes('INSERT INTO anomalies')) {
                return { rows: [], rowCount: 1 };
            }

            if (sql.includes('FROM anomalies')) {
                return { rows: cooldownRows, rowCount: 0 };
            }

            return { rows: [], rowCount: 1 };
        });

    return { query };
};

const candidate = (overrides = {}) => ({
    host_id: 1,
    bucket_start: '2026-11-23T10:00:00.000Z',
    metric_name: 'cpu_usage',
    value: 95,
    baseline_mean: 40,
    baseline_stddev: 10,
    ...overrides
});

describe('detectHourlyAnomalies', () => {
    test('requires a PostgreSQL transaction client', async () => {
        await expect(detectHourlyAnomalies()).rejects.toThrow(
            'A PostgreSQL transaction client is required'
        );
    });

    test('returns zero counts when no completed buckets are available', async () => {
        const client = createClient();

        await expect(detectHourlyAnomalies(client)).resolves.toEqual({
            examined: 0,
            detected: 0,
            cooldownSuppressed: 0
        });

        expect(client.query).toHaveBeenCalledTimes(1);
    });

    test('does not create an anomaly for a normal reading', async () => {
        const client = createClient([
            candidate({ value: 45 })
        ]);

        const result = await detectHourlyAnomalies(client);

        expect(result).toEqual({
            examined: 1,
            detected: 0,
            cooldownSuppressed: 0
        });

        expect(client.query).toHaveBeenCalledTimes(2);
        expect(client.query.mock.calls[1][0]).toContain(
            'INSERT INTO anomaly_detection_buckets'
        );
    });

    test('creates an anomaly for a reading beyond three standard deviations', async () => {
        const client = createClient([candidate()]);

        const result = await detectHourlyAnomalies(client);

        expect(result).toEqual({
            examined: 1,
            detected: 1,
            cooldownSuppressed: 0
        });

        expect(client.query).toHaveBeenCalledTimes(4);
        expect(client.query.mock.calls[2][0]).toContain(
            'INSERT INTO anomalies'
        );
        expect(client.query.mock.calls[2][0]).toContain('bucket_start');
        expect(client.query.mock.calls[3][0]).toContain(
            'INSERT INTO anomaly_detection_buckets'
        );
    });

    test('suppresses an anomaly when the six-hour cooldown is active', async () => {
        const client = createClient(
            [candidate()],
            [{ '?column?': 1 }]
        );

        const result = await detectHourlyAnomalies(client);

        expect(result).toEqual({
            examined: 1,
            detected: 0,
            cooldownSuppressed: 1
        });

        expect(client.query).toHaveBeenCalledTimes(3);
        expect(client.query.mock.calls[1][0]).toContain(
            "INTERVAL '6 hours'"
        );
        expect(client.query.mock.calls[2][0]).toContain(
            'INSERT INTO anomaly_detection_buckets'
        );
    });

    test('marks invalid candidate values as processed', async () => {
        const client = createClient([
            candidate({ value: Number.NaN })
        ]);

        const result = await detectHourlyAnomalies(client);

        expect(result).toEqual({
            examined: 1,
            detected: 0,
            cooldownSuppressed: 0
        });

        expect(client.query).toHaveBeenCalledTimes(2);
        expect(client.query.mock.calls[1][0]).toContain(
            'INSERT INTO anomaly_detection_buckets'
        );
    });

    test('scans completed buckets in chronological order across the recovery window', async () => {
        const client = createClient([
            candidate({ bucket_start: '2026-11-23T08:00:00.000Z' }),
            candidate({ bucket_start: '2026-11-23T09:00:00.000Z' }),
            candidate({ bucket_start: '2026-11-23T10:00:00.000Z' })
        ]);

        const result = await detectHourlyAnomalies(client);

        expect(result.examined).toBe(3);

        const candidateQuery = client.query.mock.calls[0][0];

        expect(candidateQuery).toContain("NOW() - INTERVAL '7 days'");
        expect(candidateQuery).toContain("date_trunc('hour', NOW())");
        expect(candidateQuery).toContain(
            'ORDER BY r.bucket_start ASC'
        );
    });
    test('does not count an anomaly when the unique bucket constraint skips its insertion', async () => {
        const client = {
            query: jest.fn()
                .mockResolvedValueOnce({ rows: [candidate()] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        };

        const result = await detectHourlyAnomalies(client);

        expect(result).toEqual({
            examined: 1,
            detected: 0,
            cooldownSuppressed: 0
        });

        expect(client.query).toHaveBeenCalledTimes(4);
        expect(client.query.mock.calls[2][0]).toContain('INSERT INTO anomalies');
    });
});
