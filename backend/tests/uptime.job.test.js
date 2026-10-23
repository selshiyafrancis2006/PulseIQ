
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

    test('limits concurrent monitor checks to five', () => {
        expect(MAX_CONCURRENT_MONITORS).toBe(5);
    });

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

    test('does not rerun a monitor before its interval elapses', async () => {
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000000);

        try {
            db.query.mockResolvedValue({
                rows: [
                    { id: 10, interval_seconds: 30, is_active: true }
                ]
            });

            await scheduleDueMonitors();
            expect(checkMonitor).toHaveBeenCalledTimes(1);

            await scheduleDueMonitors();
            expect(checkMonitor).toHaveBeenCalledTimes(1);

            nowSpy.mockReturnValue(1029999);
            await scheduleDueMonitors();
            expect(checkMonitor).toHaveBeenCalledTimes(1);

            nowSpy.mockReturnValue(1030000);
            await scheduleDueMonitors();
            expect(checkMonitor).toHaveBeenCalledTimes(2);
        } finally {
            nowSpy.mockRestore();
        }
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

});
