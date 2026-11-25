jest.mock('../../src/config/db', () => ({
    query: jest.fn(),
    connect: jest.fn()
}));

const pool = require('../../src/config/db');
const {
    withMetricRollupLock,
    rollup5Minute,
    rollup1Hour
} = require('../../src/services/metricRollup.service');

describe('withMetricRollupLock', () => {
    let client;

    beforeEach(() => {
        jest.clearAllMocks();

        client = {
            query: jest.fn().mockResolvedValue({}),
            release: jest.fn()
        };

        pool.connect.mockResolvedValue(client);
    });

    test('rejects a missing callback without opening a connection', async () => {
        await expect(withMetricRollupLock()).rejects.toThrow(TypeError);
        await expect(withMetricRollupLock('not a function')).rejects.toThrow(
            'Metric rollup lock requires a callback'
        );

        expect(pool.connect).not.toHaveBeenCalled();
    });

    test('takes the advisory lock, runs the callback and commits', async () => {
        const callback = jest.fn().mockResolvedValue('done');

        await expect(withMetricRollupLock(callback)).resolves.toBe('done');

        expect(callback).toHaveBeenCalledWith(client);
        expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
            'BEGIN',
            'SELECT pg_advisory_xact_lock(7002, 1)',
            'COMMIT'
        ]);
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    test('rolls back, rethrows and releases the connection when the callback fails', async () => {
        const failure = new Error('rollup failed');

        await expect(
            withMetricRollupLock(async () => {
                throw failure;
            })
        ).rejects.toBe(failure);

        const statements = client.query.mock.calls.map(([sql]) => sql);

        expect(statements).toContain('ROLLBACK');
        expect(statements).not.toContain('COMMIT');
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    test('still rethrows the original error when the rollback itself fails', async () => {
        const failure = new Error('rollup failed');
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        client.query.mockImplementation(async (sql) => {
            if (sql === 'ROLLBACK') {
                throw new Error('connection lost');
            }

            return {};
        });

        try {
            await expect(
                withMetricRollupLock(async () => {
                    throw failure;
                })
            ).rejects.toBe(failure);

            expect(errorSpy).toHaveBeenCalledWith(
                'Metric rollup transaction rollback failed:',
                expect.objectContaining({ message: 'connection lost' })
            );
            expect(client.release).toHaveBeenCalledTimes(1);
        } finally {
            errorSpy.mockRestore();
        }
    });

    test('rolls back when taking the lock fails', async () => {
        client.query.mockImplementation(async (sql) => {
            if (sql.startsWith('SELECT pg_advisory_xact_lock')) {
                throw new Error('lock unavailable');
            }

            return {};
        });

        const callback = jest.fn();

        await expect(withMetricRollupLock(callback)).rejects.toThrow('lock unavailable');

        expect(callback).not.toHaveBeenCalled();
        expect(client.query).toHaveBeenCalledWith('ROLLBACK');
        expect(client.release).toHaveBeenCalledTimes(1);
    });
});

describe('rollup backfill range validation', () => {
    // 1_800_000_000_000 ms is a whole number of 5-minute and 1-hour buckets,
    // so "now" sits exactly on a bucket boundary and the cases below are
    // deterministic.
    const NOW = 1_800_000_000_000;
    const FIVE_MINUTES = 5 * 60 * 1000;
    const HOUR = 60 * 60 * 1000;

    let nowSpy;

    beforeEach(() => {
        jest.clearAllMocks();
        nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
    });

    afterEach(() => {
        nowSpy.mockRestore();
    });

    test.each([
        ['5-minute', rollup5Minute],
        ['hourly', rollup1Hour]
    ])('%s backfill requires a from/to range object', async (label, rollup) => {
        await expect(rollup(pool, 'yesterday')).rejects.toThrow(
            'backfill requires a from/to range'
        );

        expect(pool.query).not.toHaveBeenCalled();
    });

    test.each([
        ['5-minute', rollup5Minute],
        ['hourly', rollup1Hour]
    ])('%s backfill rejects dates that cannot be parsed', async (label, rollup) => {
        await expect(
            rollup(pool, { from: 'not-a-date', to: 'also-not-a-date' })
        ).rejects.toThrow('backfill range must contain valid dates');

        expect(pool.query).not.toHaveBeenCalled();
    });

    test('5-minute backfill rejects a range whose from is not before its to', async () => {
        const at = new Date(NOW - HOUR).toISOString();

        await expect(rollup5Minute(pool, { from: at, to: at })).rejects.toThrow(
            'from must be earlier than to'
        );

        expect(pool.query).not.toHaveBeenCalled();
    });

    test('hourly backfill rejects a range whose from is after its to', async () => {
        await expect(
            rollup1Hour(pool, {
                from: new Date(NOW - HOUR).toISOString(),
                to: new Date(NOW - 2 * HOUR).toISOString()
            })
        ).rejects.toThrow('from must be earlier than to');

        expect(pool.query).not.toHaveBeenCalled();
    });

    test('5-minute backfill cannot include the current incomplete bucket', async () => {
        await expect(
            rollup5Minute(pool, {
                from: new Date(NOW).toISOString(),
                to: new Date(NOW + FIVE_MINUTES).toISOString()
            })
        ).rejects.toThrow('cannot include an incomplete current bucket');

        expect(pool.query).not.toHaveBeenCalled();
    });

    test('hourly backfill cannot include the current incomplete hour', async () => {
        await expect(
            rollup1Hour(pool, {
                from: new Date(NOW).toISOString(),
                to: new Date(NOW + HOUR).toISOString()
            })
        ).rejects.toThrow('cannot include an incomplete current bucket');

        expect(pool.query).not.toHaveBeenCalled();
    });

    test('a valid complete range is passed to the database as parameters', async () => {
        pool.query.mockResolvedValue({ rowCount: 0 });

        const from = new Date(NOW - 2 * HOUR).toISOString();
        const to = new Date(NOW - HOUR).toISOString();

        await rollup5Minute(pool, { from, to });

        expect(pool.query).toHaveBeenCalledTimes(2);

        for (const [, params] of pool.query.mock.calls) {
            expect(params).toEqual([from, to]);
        }
    });
});