
jest.mock('../../src/config/db', () => ({
    query: jest.fn()
}));

const pool = require('../../src/config/db');
const { cleanupHistoricalData } = require('../../src/services/metricRollup.service');

describe('cleanupHistoricalData', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        pool.query.mockResolvedValue({ rowCount: 0 });
    });

    test('deletes expired rollups, anomalies, and traces using the intended retention windows', async () => {
        const result = await cleanupHistoricalData();

        expect(pool.query).toHaveBeenCalledTimes(4);

        const queries = pool.query.mock.calls.map(([sql]) => sql);

        expect(queries[0]).toContain('DELETE FROM metric_rollups_5m');
        expect(queries[0]).toContain("INTERVAL '8 days'");

        expect(queries[1]).toContain('DELETE FROM metric_rollups_1h');
        expect(queries[1]).toContain("INTERVAL '90 days'");

        expect(queries[2]).toContain('DELETE FROM anomalies');
        expect(queries[2]).toContain("INTERVAL '30 days'");

        expect(queries[3]).toContain('DELETE FROM traces');
        expect(queries[3]).toContain("INTERVAL '7 days'");

        expect(result).toEqual({
            '5-minute rollups': 0,
            'hourly rollups': 0,
            anomalies: 0,
            traces: 0
        });
    });

    test('returns the number of deleted rows for each table', async () => {
        pool.query
            .mockResolvedValueOnce({ rowCount: 5 })
            .mockResolvedValueOnce({ rowCount: 2 })
            .mockResolvedValueOnce({ rowCount: 3 })
            .mockResolvedValueOnce({ rowCount: 7 });

        const result = await cleanupHistoricalData();

        expect(result).toEqual({
            '5-minute rollups': 5,
            'hourly rollups': 2,
            anomalies: 3,
            traces: 7
        });
    });

    test('propagates database errors instead of reporting false success', async () => {
        pool.query.mockRejectedValueOnce(new Error('Database unavailable'));

        await expect(cleanupHistoricalData()).rejects.toThrow('Database unavailable');
    });
});
