jest.mock('../src/config/db', () => ({
    query: jest.fn()
}));

const pool = require('../src/config/db');
const {
    fetchMetricQuery,
    MAX_QUERY_ROWS
} = require('../src/services/metricsQuery.service');

describe('metricsQuery.service row limit', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('binds host IDs, timestamps, step interval and row limit as SQL parameters', async () => {
        pool.query.mockResolvedValue({ rows: [] });

        const from = new Date('2026-11-17T10:00:00.000Z');
        const to = new Date('2026-11-17T11:00:00.000Z');

        await fetchMetricQuery({
            hostIds: [17, 23],
            from,
            to,
            step: '5m',
            agg: 'avg',
            sources: [{
                from,
                to,
                source: {
                    type: 'raw',
                    table: 'metrics'
                }
            }]
        });

        const [sql, values] = pool.query.mock.calls[0];

        expect(values).toContainEqual([17, 23]);
        expect(values).toContain(from);
        expect(values).toContain(to);
        expect(values).toContain('5 minutes');
        expect(values).toContain(MAX_QUERY_ROWS + 1);

        expect(sql).not.toContain('17,23');
        expect(sql).not.toContain('2026-11-17T10:00:00.000Z');
        expect(sql).not.toContain('5 minutes');
    });

    test.each([
        ['empty array', []],
        ['undefined sources', undefined]
    ])('returns an empty array without querying the database for %s', async (_label, sources) => {
        const result = await fetchMetricQuery({
            hostIds: [1],
            from: new Date('2026-11-17T10:00:00.000Z'),
            to: new Date('2026-11-17T11:00:00.000Z'),
            step: '5m',
            agg: 'avg',
            sources
        });

        expect(result).toEqual([]);
        expect(pool.query).not.toHaveBeenCalled();
    });

    test('includes sample count and latest source timestamp in each aggregated bucket', async () => {
        pool.query.mockResolvedValue({ rows: [] });

        const from = new Date('2026-11-17T10:00:00.000Z');
        const to = new Date('2026-11-17T11:00:00.000Z');

        await fetchMetricQuery({
            hostIds: [1],
            from,
            to,
            step: '5m',
            agg: 'avg',
            sources: [{
                from,
                to,
                source: {
                    type: 'raw',
                    table: 'metrics'
                }
            }]
        });

        const [sql] = pool.query.mock.calls[0];

        expect(sql).toMatch(/SUM\(sample_count\)::bigint AS sample_count/);
        expect(sql).toMatch(/MAX\(source_timestamp\) AS latest_sample_timestamp/);
        expect(sql).toContain('FROM combined');
        expect(sql).toContain('GROUP BY');
    });

    test('limits the final aggregated query to MAX_QUERY_ROWS + 1', async () => {
        const rows = [{ host_id: 1, cpu_usage: 50 }];

        pool.query.mockResolvedValue({ rows });

        const from = new Date('2026-11-17T10:00:00.000Z');
        const to = new Date('2026-11-17T11:00:00.000Z');

        const result = await fetchMetricQuery({
            hostIds: [1],
            from,
            to,
            step: '5m',
            agg: 'avg',
            sources: [{
                from,
                to,
                source: {
                    type: 'raw',
                    table: 'metrics'
                }
            }]
        });

        const [sql, values] = pool.query.mock.calls[0];

        expect(sql).toMatch(/LIMIT \$\d+/);
        expect(values[values.length - 1]).toBe(MAX_QUERY_ROWS + 1);
        expect(result).toEqual(rows);
    });
});
