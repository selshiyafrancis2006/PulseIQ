jest.mock('node-cron', () => ({
    schedule: jest.fn()
}));

jest.mock('../src/services/metricRollup.service', () => ({
    rollup5Minute: jest.fn(),
    rollup1Hour: jest.fn(),
    cleanupRawMetrics: jest.fn(),
    cleanupHistoricalData: jest.fn(),
    RAW_RETENTION_DAYS: 3
}));

jest.mock('../src/services/monitorRollup.service', () => ({
    rollupRecentMonitorResults: jest.fn(),
    cleanupMonitorResults: jest.fn()
}));

describe('metric rollup scheduler', () => {
    let cron;
    let rollup5Minute;
    let rollup1Hour;

    beforeEach(() => {
        jest.resetModules();

        cron = require('node-cron');

        ({
            rollup5Minute,
            rollup1Hour
        } = require('../src/services/metricRollup.service'));

        rollup5Minute.mockResolvedValue();
        rollup1Hour.mockResolvedValue();

        require('../src/jobs/rollup.job');
    });

    test('registers serialized metric schedules with noOverlap', () => {
        expect(cron.schedule).toHaveBeenNthCalledWith(
            1,
            '*/5 * * * *',
            expect.any(Function),
            { noOverlap: true }
        );

        expect(cron.schedule).toHaveBeenNthCalledWith(
            2,
            '2 * * * *',
            expect.any(Function),
            { noOverlap: true }
        );
    });

    test('waits for the 5-minute rollup before starting the hourly rollup', async () => {
        let finishFiveMinute;

        rollup5Minute.mockImplementation(
            () => new Promise((resolve) => {
                finishFiveMinute = resolve;
            })
        );

        const fiveMinuteCallback = cron.schedule.mock.calls[0][1];
        const hourlyCallback = cron.schedule.mock.calls[1][1];

        const fiveMinuteRun = fiveMinuteCallback();

        await Promise.resolve();

        expect(rollup5Minute).toHaveBeenCalledTimes(1);

        const hourlyRun = hourlyCallback();

        await Promise.resolve();

        expect(rollup1Hour).not.toHaveBeenCalled();

        finishFiveMinute();

        await Promise.all([fiveMinuteRun, hourlyRun]);

        expect(rollup1Hour).toHaveBeenCalledTimes(1);
    });

    test('continues processing after a metric rollup fails', async () => {
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        try {
            rollup5Minute.mockRejectedValueOnce(
                new Error('Simulated rollup failure')
            );

            const fiveMinuteCallback = cron.schedule.mock.calls[0][1];
            const hourlyCallback = cron.schedule.mock.calls[1][1];

            await fiveMinuteCallback();
            await hourlyCallback();

            expect(rollup1Hour).toHaveBeenCalledTimes(1);
            expect(errorSpy).toHaveBeenCalled();
        } finally {
            errorSpy.mockRestore();
        }
    });
});
