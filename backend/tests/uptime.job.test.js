
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

    beforeEach(() => {
        jest.resetModules();

        db = require('../src/config/db');
        cron = require('node-cron');
        checkMonitor = require('../src/services/uptime.service').checkMonitor;

        ({
            scheduleDueMonitors,
            MAX_CONCURRENT_MONITORS
        } = require('../src/jobs/uptime.job'));

        db.query.mockResolvedValue({ rows: [] });
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

    test('runs active monitors immediately and skips invalid intervals', async () => {
        db.query.mockResolvedValue({
            rows: [
                { id: 1, interval_seconds: 30, is_active: true },
                { id: 2, interval_seconds: 29, is_active: true },
                { id: 3, interval_seconds: 3601, is_active: true }
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
        } finally {
            errorSpy.mockRestore();
        }
    });

    test('checks monitors only when the database returns them as due', async () => {
    const monitor = {
        id: 10,
        interval_seconds: 30,
        is_active: true
    };

    db.query
        .mockResolvedValueOnce({ rows: [monitor] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [monitor] });

    await scheduleDueMonitors();
    expect(checkMonitor).toHaveBeenCalledTimes(1);

    await Promise.resolve();

    await scheduleDueMonitors();
    expect(checkMonitor).toHaveBeenCalledTimes(1);

    await scheduleDueMonitors();
    expect(checkMonitor).toHaveBeenCalledTimes(1);

    await scheduleDueMonitors();
    expect(checkMonitor).toHaveBeenCalledTimes(2);
});


    test('limits active checks and schedules a waiting monitor when capacity frees', async () => {
        const pendingChecks = [];

        checkMonitor.mockImplementation(
            () =>
                new Promise((resolve) => {
                    pendingChecks.push(resolve);
                })
        );

        db.query.mockResolvedValue({
            rows: Array.from({ length: 6 }, (_, index) => ({
                id: index + 1,
                interval_seconds: 30,
                is_active: true
            }))
        });

        await scheduleDueMonitors();

        expect(checkMonitor).toHaveBeenCalledTimes(5);
        expect(pendingChecks).toHaveLength(5);

        pendingChecks[0]({});
        await Promise.resolve();
        await Promise.resolve();

        await scheduleDueMonitors();

        expect(checkMonitor).toHaveBeenCalledTimes(6);
        expect(pendingChecks).toHaveLength(6);
    });

    test('runs monitors with no previous check result immediately', async () => {
    db.query.mockResolvedValue({
        rows: [
            { id: 20, interval_seconds: 30, last_checked_at: null }
        ]
    });

    await scheduleDueMonitors();

    expect(checkMonitor).toHaveBeenCalledTimes(1);
    expect(checkMonitor).toHaveBeenCalledWith(
        expect.objectContaining({ id: 20 })
    );
});

test('does not run monitors that are not yet due', async () => {
    db.query.mockResolvedValue({ rows: [] });

    await scheduleDueMonitors();

    expect(checkMonitor).not.toHaveBeenCalled();
});

test('runs overdue monitors returned by the database', async () => {
    db.query.mockResolvedValue({
        rows: [
            {
                id: 30,
                interval_seconds: 30,
                last_checked_at: new Date(Date.now() - 60000)
            }
        ]
    });

    await scheduleDueMonitors();

    expect(checkMonitor).toHaveBeenCalledTimes(1);
    expect(checkMonitor).toHaveBeenCalledWith(
        expect.objectContaining({ id: 30 })
    );
});

test('queries only due active monitors using the latest persisted check', async () => {
    db.query.mockResolvedValue({ rows: [] });

    await scheduleDueMonitors();

    const sql = db.query.mock.calls[0][0];

    expect(sql).toMatch(/LEFT JOIN LATERAL/i);
    expect(sql).toMatch(/monitor_results/i);
    expect(sql).toMatch(/checked_at/i);
    expect(sql).toMatch(/interval_seconds/i);
    expect(sql).toMatch(/ORDER BY/i);
});

});
