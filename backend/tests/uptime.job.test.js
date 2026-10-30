const CLAIM_TOKEN_1 = '11111111-1111-4111-8111-111111111111';
const CLAIM_TOKEN_2 = '22222222-2222-4222-8222-222222222222';
const CLAIM_TOKEN_3 = '33333333-3333-4333-8333-333333333333';
const CLAIM_TOKEN_4 = '44444444-4444-4444-8444-444444444444';
const CLAIM_TOKEN_5 = '55555555-5555-4555-8555-555555555555';
const CLAIM_TOKEN_6 = '66666666-6666-4666-8666-666666666666';

jest.mock('../src/config/db', () => ({
    query: jest.fn()
}));

jest.mock('node-cron', () => ({
    schedule: jest.fn()
}));

jest.mock('../src/services/uptime.service', () => ({
    checkMonitor: jest.fn()
}));

jest.mock('../src/services/hostStatus.service', () => ({
    checkHostStatus: jest.fn()
}));

describe('uptime scheduler', () => {
    let db;
    let cron;
    let checkMonitor;
    let scheduleDueMonitors;
    let MAX_CONCURRENT_MONITORS;

    function mockClaimResults(...batches) {
        const pendingBatches = [...batches];

        db.query.mockImplementation(async (sql) => {
            if (/WITH due AS/i.test(sql)) {
                return {
                    rows: pendingBatches.length
                        ? pendingBatches.shift()
                        : []
                };
            }

            // Renewal and release queries return no matching rows.
            return { rows: [] };
        });
    }
    beforeEach(() => {
        jest.resetModules();

        db = require('../src/config/db');
        cron = require('node-cron');
        checkMonitor = require('../src/services/uptime.service').checkMonitor;

        ({
            scheduleDueMonitors,
            MAX_CONCURRENT_MONITORS
        } = require('../src/jobs/uptime.job'));

        db.query.mockImplementation(async (sql) => {
            if (/WITH due AS/i.test(sql)) {
                return { rows: [] };
            }

            // Renewal and release queries return no matching rows by default.
            return { rows: [] };
        });

        checkMonitor.mockResolvedValue({});
    });

    test('registers independent host and monitor schedules', () => {
        expect(cron.schedule).toHaveBeenCalledWith(
            '*/10 * * * * *',
            expect.any(Function)
        );

        expect(cron.schedule).toHaveBeenCalledWith(
            '* * * * * *',
            expect.any(Function)
        );
    });

    test('uses five concurrent checks by default', () => {
        const original = process.env.UPTIME_MAX_CONCURRENT_MONITORS;

        try {
            delete process.env.UPTIME_MAX_CONCURRENT_MONITORS;
            jest.resetModules();

            const { MAX_CONCURRENT_MONITORS } =
                require('../src/jobs/uptime.job');

            expect(MAX_CONCURRENT_MONITORS).toBe(5);
        } finally {
            if (original === undefined) {
                delete process.env.UPTIME_MAX_CONCURRENT_MONITORS;
            } else {
                process.env.UPTIME_MAX_CONCURRENT_MONITORS = original;
            }

            jest.resetModules();
        }
    });

    test('uses a valid custom concurrency setting', () => {
        const original = process.env.UPTIME_MAX_CONCURRENT_MONITORS;

        try {
            process.env.UPTIME_MAX_CONCURRENT_MONITORS = '12';
            jest.resetModules();

            const { MAX_CONCURRENT_MONITORS } =
                require('../src/jobs/uptime.job');

            expect(MAX_CONCURRENT_MONITORS).toBe(12);
        } finally {
            if (original === undefined) {
                delete process.env.UPTIME_MAX_CONCURRENT_MONITORS;
            } else {
                process.env.UPTIME_MAX_CONCURRENT_MONITORS = original;
            }

            jest.resetModules();
        }
    });

    test.each(['0', '51', '2.5', 'invalid'])(
        'falls back to five for invalid concurrency setting: %s',
        (value) => {
            const original = process.env.UPTIME_MAX_CONCURRENT_MONITORS;

            try {
                process.env.UPTIME_MAX_CONCURRENT_MONITORS = value;
                jest.resetModules();

                const { MAX_CONCURRENT_MONITORS } =
                    require('../src/jobs/uptime.job');

                expect(MAX_CONCURRENT_MONITORS).toBe(5);
            } finally {
                if (original === undefined) {
                    delete process.env.UPTIME_MAX_CONCURRENT_MONITORS;
                } else {
                    process.env.UPTIME_MAX_CONCURRENT_MONITORS = original;
                }

                jest.resetModules();
            }
        }
    );

    test('runs claimed monitors and skips invalid intervals', async () => {
        db.query.mockResolvedValue({
            rows: [
                {
                    id: 1,
                    interval_seconds: 30,
                    is_active: true,
                    check_claim_token: CLAIM_TOKEN_1
                },
                {
                    id: 2,
                    interval_seconds: 29,
                    is_active: true,
                    check_claim_token: CLAIM_TOKEN_2
                },
                {
                    id: 3,
                    interval_seconds: 3601,
                    is_active: true,
                    check_claim_token: CLAIM_TOKEN_3
                }
            ]
        });

        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        try {
            await scheduleDueMonitors();

            expect(checkMonitor).toHaveBeenCalledTimes(1);
            expect(checkMonitor).toHaveBeenCalledWith(
                expect.objectContaining({ id: 1 })
            );
            expect(errorSpy).toHaveBeenCalledTimes(2);
            expect(db.query).toHaveBeenCalledWith(
                expect.any(String),
                [5]
            );
        } finally {
            errorSpy.mockRestore();
        }
    });

    test('checks monitors only when the database claims them as due', async () => {
        const monitor = {
            id: 10,
            interval_seconds: 30,
            is_active: true,
            check_claim_token: CLAIM_TOKEN_4
        };

        mockClaimResults([monitor], [], [], [monitor]);

        await scheduleDueMonitors();
        expect(checkMonitor).toHaveBeenCalledTimes(1);

        await scheduleDueMonitors();
        expect(checkMonitor).toHaveBeenCalledTimes(1);

        await scheduleDueMonitors();
        expect(checkMonitor).toHaveBeenCalledTimes(1);

        await scheduleDueMonitors();
        expect(checkMonitor).toHaveBeenCalledTimes(2);
    });

    test('limits active checks and claims another monitor when capacity frees', async () => {
        const pendingChecks = [];

        checkMonitor.mockImplementation(
            () => new Promise((resolve) => {
                pendingChecks.push(resolve);
            })
        );

        const firstBatch = Array.from({ length: 5 }, (_, index) => ({
            id: index + 1,
            interval_seconds: 30,
            is_active: true,
            check_claim_token: [
                CLAIM_TOKEN_1,
                CLAIM_TOKEN_2,
                CLAIM_TOKEN_3,
                CLAIM_TOKEN_4,
                CLAIM_TOKEN_5
            ][index]
        }));

        const nextMonitor = {
            id: 6,
            interval_seconds: 30,
            is_active: true,
            check_claim_token: CLAIM_TOKEN_6
        };

        mockClaimResults(firstBatch, [nextMonitor]);

        await scheduleDueMonitors();

        expect(checkMonitor).toHaveBeenCalledTimes(5);
        expect(pendingChecks).toHaveLength(5);
        expect(db.query).toHaveBeenNthCalledWith(
            1,
            expect.any(String),
            [5]
        );

        pendingChecks[0]({});

        // The slot is only freed after the claim has been released, so wait
        // for that async chain to finish rather than a fixed number of ticks.
        await new Promise((resolve) => setImmediate(resolve));

        await scheduleDueMonitors();

        expect(checkMonitor).toHaveBeenCalledTimes(6);
        expect(pendingChecks).toHaveLength(6);

        // Call 2 is the finished monitor releasing its claim; call 3 claims
        // exactly one new monitor for the single free slot.
        expect(db.query).toHaveBeenNthCalledWith(
            2,
            expect.stringMatching(/check_claim_token\s*=\s*NULL/i),
            [1, CLAIM_TOKEN_1]
        );
        expect(db.query).toHaveBeenNthCalledWith(
            3,
            expect.stringMatching(/WITH due AS/i),
            [1]
        );
    });

    test('runs monitors with no previous check result when claimed', async () => {
        db.query.mockResolvedValue({
            rows: [
                {
                    id: 20,
                    interval_seconds: 30,
                    is_active: true,
                    check_claim_token: CLAIM_TOKEN_1
                }
            ]
        });

        await scheduleDueMonitors();

        expect(checkMonitor).toHaveBeenCalledTimes(1);
        expect(checkMonitor).toHaveBeenCalledWith(
            expect.objectContaining({ id: 20 })
        );
    });

    test('does not run monitors when no due monitors are claimed', async () => {
        db.query.mockResolvedValue({ rows: [] });

        await scheduleDueMonitors();

        expect(checkMonitor).not.toHaveBeenCalled();
    });

    test('runs overdue monitors returned by the database claim', async () => {
        db.query.mockResolvedValue({
            rows: [
                {
                    id: 30,
                    interval_seconds: 30,
                    next_check_at: new Date(Date.now() + 30000),
                    check_claim_token: CLAIM_TOKEN_1
                }
            ]
        });

        await scheduleDueMonitors();

        expect(checkMonitor).toHaveBeenCalledTimes(1);
        expect(checkMonitor).toHaveBeenCalledWith(
            expect.objectContaining({ id: 30 })
        );
    });

    test('atomically claims due active monitors using SKIP LOCKED and a batch limit', async () => {
        db.query.mockResolvedValue({ rows: [] });

        await scheduleDueMonitors();

        const [sql, parameters] = db.query.mock.calls[0];

        expect(sql).toMatch(/WITH due AS/i);
        expect(sql).toMatch(/next_check_at <= NOW\(\)/i);
        expect(sql).toMatch(/WHERE is_active = TRUE/i);
        expect(sql).toMatch(/ORDER BY next_check_at ASC, id ASC/i);
        expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/i);
        expect(sql).toMatch(/LIMIT \$1/i);
        expect(sql).toMatch(/UPDATE monitors/i);
        expect(sql).toMatch(/SET next_check_at/i);
        expect(sql).toMatch(/check_claim_token\s*=\s*gen_random_uuid\(\)/i);
        expect(sql).toMatch(/check_claimed_until/i);
        expect(sql).toMatch(/check_claimed_until IS NULL/i);
        expect(sql).toMatch(/check_claimed_until <= NOW\(\)/i);
        expect(sql).toMatch(/make_interval/i);
        expect(sql).toMatch(/RETURNING m\.\*/i);
        expect(sql).not.toMatch(/LEFT JOIN LATERAL/i);
        expect(parameters).toEqual([5]);
    });

    test('does not issue another claim while a scheduler tick is pending', async () => {
        let finishQuery;

        db.query.mockImplementationOnce(
            () => new Promise((resolve) => {
                finishQuery = resolve;
            })
        );

        const firstRun = scheduleDueMonitors();

        await Promise.resolve();

        await scheduleDueMonitors();

        expect(db.query).toHaveBeenCalledTimes(1);

        finishQuery({ rows: [] });
        await firstRun;
    });
});
