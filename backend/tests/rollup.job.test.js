jest.mock('node-cron', () => ({
    schedule: jest.fn()
}));

jest.mock('../src/services/metricRollup.service', () => ({
    withMetricRollupLock: jest.fn(async (callback) => callback({ query: jest.fn() })),
    rollup5Minute: jest.fn(),
    rollup1Hour: jest.fn(),
    cleanupRawMetrics: jest.fn(),
    cleanupHistoricalData: jest.fn(),
    RAW_RETENTION_DAYS: 3
}));

jest.mock('../src/services/jobRunStore.service', () => ({
    saveJobRun: jest.fn(async () => {}),
    loadJobRuns: jest.fn(async () => [])
}));

jest.mock('../src/services/monitorRollup.service', () => ({
    rollupRecentMonitorResults: jest.fn(),
    cleanupMonitorResults: jest.fn()
}));

describe('metric rollup scheduler', () => {
    let cron;
    let withMetricRollupLock;
    let rollup5Minute;
    let rollup1Hour;

    beforeEach(() => {
        jest.resetModules();

        cron = require('node-cron');

        ({
            withMetricRollupLock,
            rollup5Minute,
            rollup1Hour
        } = require('../src/services/metricRollup.service'));

        withMetricRollupLock.mockImplementation(async (callback) => callback({ query: jest.fn() }));
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

    test('saves the state of a metric rollup after it succeeds', async () => {
        const { saveJobRun } = require('../src/services/jobRunStore.service');

        await cron.schedule.mock.calls[0][1]();

        expect(saveJobRun).toHaveBeenCalledWith(
            '5m',
            expect.objectContaining({
                lastSuccessAt: expect.any(String),
                consecutiveFailures: 0
            })
        );
    });

    test('saves the failure of a metric rollup', async () => {
        const { saveJobRun } = require('../src/services/jobRunStore.service');
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            rollup1Hour.mockRejectedValueOnce(new Error('Simulated hourly failure'));

            await cron.schedule.mock.calls[1][1]();

            expect(saveJobRun).toHaveBeenCalledWith(
                '1h',
                expect.objectContaining({
                    lastError: 'Simulated hourly failure',
                    consecutiveFailures: 1
                })
            );
        } finally {
            errorSpy.mockRestore();
        }
    });

    test('tracks the daily cleanup as one job that succeeds when every step succeeds', async () => {
        const { saveJobRun } = require('../src/services/jobRunStore.service');
        const cleanup = cron.schedule.mock.calls.find((call) => call[0] === '0 3 * * *')[1];

        await cleanup();

        expect(saveJobRun).toHaveBeenCalledWith(
            'cleanup',
            expect.objectContaining({
                lastSuccessAt: expect.any(String),
                consecutiveFailures: 0
            })
        );
    });

    test('a failing cleanup step still runs the other steps and records a failure', async () => {
        const { saveJobRun } = require('../src/services/jobRunStore.service');
        const { cleanupRawMetrics, cleanupHistoricalData } =
            require('../src/services/metricRollup.service');
        const { cleanupMonitorResults } =
            require('../src/services/monitorRollup.service');
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            cleanupRawMetrics.mockRejectedValueOnce(new Error('Raw cleanup failed'));

            const cleanup = cron.schedule.mock.calls.find((call) => call[0] === '0 3 * * *')[1];

            await cleanup();

            expect(cleanupHistoricalData).toHaveBeenCalled();
            expect(cleanupMonitorResults).toHaveBeenCalled();
            expect(saveJobRun).toHaveBeenCalledWith(
                'cleanup',
                expect.objectContaining({
                    lastError: 'Raw cleanup failed',
                    consecutiveFailures: 1
                })
            );
        } finally {
            errorSpy.mockRestore();
        }
    });
});

describe('metric rollup scheduler - saved job state', () => {
    test('restores saved state when the backend starts', async () => {
        jest.resetModules();

        const { loadJobRuns } = require('../src/services/jobRunStore.service');

        loadJobRuns.mockResolvedValueOnce([
            {
                jobName: '5m',
                lastSuccessAt: '2026-11-20T11:58:00.000Z',
                lastFailureAt: null,
                lastError: null,
                consecutiveFailures: 0
            }
        ]);

        require('../src/jobs/rollup.job');
        await new Promise((resolve) => setImmediate(resolve));

        const health = require('../src/services/metricRollupHealth.service');

        expect(health.getJobState('5m').lastSuccessAt).toBe('2026-11-20T11:58:00.000Z');
    });
});