jest.mock('../src/config/db', () => ({
    query: jest.fn()
}));

const pool = require('../src/config/db');

const {
    fetchCustomMetricQuery,
    fetchCustomMetricNames,
    MAX_CUSTOM_QUERY_ROWS
} = require('../src/services/customMetricsQuery.service');

describe('customMetricsQuery.service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const validQuery = {
        hostId: 17,
        metricName: 'disk_usage_percent',
        from: new Date('2026-11-22T10:00:00.000Z'),
        to: new Date('2026-11-22T11:00:00.000Z'),
        step: '5m',
        aggregation: 'avg'
    };

    test('binds query values, interval and row limit as SQL parameters', async () => {
        pool.query.mockResolvedValue({ rows: [] });

        await fetchCustomMetricQuery(validQuery);

        const [sql, values] = pool.query.mock.calls[0];

        expect(values).toEqual([
            '5 minutes',
            17,
            'disk_usage_percent',
            validQuery.from,
            validQuery.to,
            MAX_CUSTOM_QUERY_ROWS + 1
        ]);

        expect(sql).toContain('FROM custom_metrics');
        expect(sql).toContain('LIMIT $6');
        expect(sql).not.toContain('disk_usage_percent');
        expect(sql).toContain("INTERVAL '5 minutes'");
        expect(sql).not.toContain('2026-11-22T10:00:00.000Z');
    });

    test('preserves tag dimensions in aggregation grouping', async () => {
        pool.query.mockResolvedValue({ rows: [] });

        await fetchCustomMetricQuery(validQuery);

        const [sql] = pool.query.mock.calls[0];

        expect(sql).toContain('tags');
        expect(sql).toMatch(/GROUP BY timestamp, unit, tags/);
        expect(sql).toContain('date_bin');
    });

    test.each([
        ['avg', 'AVG(value)'],
        ['min', 'MIN(value)'],
        ['max', 'MAX(value)']
    ])('uses the allowlisted %s aggregation', async (aggregation, expression) => {
        pool.query.mockResolvedValue({ rows: [] });

        await fetchCustomMetricQuery({
            ...validQuery,
            aggregation
        });

        const [sql] = pool.query.mock.calls[0];

        expect(sql).toContain(`${expression} AS value`);
    });

    test.each([
        ['unsupported interval', { step: '2m' }],
        ['unsupported aggregation', { aggregation: 'sum' }],
        ['invalid host ID', { hostId: 0 }],
        ['decimal host ID', { hostId: 1.5 }],
        ['invalid metric name', { metricName: 'bad metric name' }],
        ['zero row limit', { limit: 0 }],
        ['excessive row limit', { limit: MAX_CUSTOM_QUERY_ROWS + 2 }]
    ])('rejects %s before querying the database', async (_label, overrides) => {
        await expect(
            fetchCustomMetricQuery({
                ...validQuery,
                ...overrides
            })
        ).rejects.toThrow();

        expect(pool.query).not.toHaveBeenCalled();
    });

    test('returns aggregated rows from the database', async () => {
        const rows = [{
            timestamp: new Date('2026-11-22T10:00:00.000Z'),
            unit: '%',
            tags: { mount: '/' },
            value: 72.5,
            sample_count: 3,
            latest_sample_timestamp: new Date('2026-11-22T10:04:00.000Z')
        }];

        pool.query.mockResolvedValue({ rows });

        const result = await fetchCustomMetricQuery(validQuery);

        expect(result).toEqual(rows);
    });

    test('queries raw, five-minute and hourly historical sources', async () => {
        pool.query.mockResolvedValue({ rows: [] });

        await fetchCustomMetricQuery({
            ...validQuery,
            from: new Date(Date.now() - 2 * 60 * 60 * 1000),
            to: new Date()
        });

        const [sql] = pool.query.mock.calls[0];

        expect(sql).toContain('FROM custom_metrics');
        expect(sql).toContain('FROM metric_rollups_5m_generic');
        expect(sql).toContain('FROM metric_rollups_1h_generic');
        expect(sql).toContain('UNION ALL');
        expect(sql).toContain('GROUP BY timestamp, unit, tags');
        expect(sql).toContain('sample_count');
    });

    test('rejects one-minute resolution when the range is older than 3 days', async () => {
        await expect(
            fetchCustomMetricQuery({
                ...validQuery,
                from: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
                step: '1m'
            })
        ).rejects.toThrow('minimum resolution of 5 minutes');

        expect(pool.query).not.toHaveBeenCalled();
    });

    test('rejects sub-hour resolution when the range is older than 8 days', async () => {
        await expect(
            fetchCustomMetricQuery({
                ...validQuery,
                from: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000),
                step: '15m'
            })
        ).rejects.toThrow('minimum resolution of 1 hour');

        expect(pool.query).not.toHaveBeenCalled();
    });

    test('allows five-minute resolution for a 4-day-old range', async () => {
        pool.query.mockResolvedValue({ rows: [] });

        await expect(
            fetchCustomMetricQuery({
                ...validQuery,
                from: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
                step: '5m'
            })
        ).resolves.toEqual([]);

        expect(pool.query).toHaveBeenCalledTimes(1);
    });
    describe('fetchCustomMetricNames', () => {
        test('queries metric names and units for the requested host', async () => {
            const rows = [{
                metric_name: 'disk_usage_percent',
                unit: '%',
                latest_sample_timestamp: new Date('2026-11-23T10:00:00.000Z'),
                sample_count: 12
            }];

            pool.query.mockResolvedValue({ rows });

            const result = await fetchCustomMetricNames(17);

            expect(pool.query).toHaveBeenCalledTimes(1);

            const [sql, values] = pool.query.mock.calls[0];

            expect(values).toEqual([17]);
            expect(sql).toContain('FROM custom_metrics');
            expect(sql).toContain('GROUP BY metric_name, unit');
            expect(sql).toContain('LIMIT 500');
            expect(result).toEqual(rows);
        });

        test.each([0, -1, 1.5, NaN, '17'])(
            'rejects invalid host ID: %s',
            async (hostId) => {
                await expect(
                    fetchCustomMetricNames(hostId)
                ).rejects.toThrow('Invalid custom metric host ID');

                expect(pool.query).not.toHaveBeenCalled();
            }
        );
    });
});




