const { pool } = require('./helpers');
const { saveJobRun, loadJobRuns } = require('../src/services/jobRunStore.service');

describe('job run store', () => {
    beforeEach(async () => {
        await pool.query('DELETE FROM job_runs');
    });

    afterAll(async () => {
        await pool.query('DELETE FROM job_runs');
        await pool.end();
    });

    test('saves a job run and loads it back', async () => {
        await saveJobRun('5m', {
            lastSuccessAt: '2026-11-20T11:58:00.000Z',
            lastFailureAt: null,
            lastError: null,
            consecutiveFailures: 0
        });

        expect(await loadJobRuns()).toEqual([
            {
                jobName: '5m',
                lastSuccessAt: '2026-11-20T11:58:00.000Z',
                lastFailureAt: null,
                lastError: null,
                consecutiveFailures: 0
            }
        ]);
    });

    test('saving the same job again replaces the stored state', async () => {
        await saveJobRun('1h', {
            lastSuccessAt: '2026-11-20T10:02:00.000Z',
            lastFailureAt: null,
            lastError: null,
            consecutiveFailures: 0
        });

        await saveJobRun('1h', {
            lastSuccessAt: '2026-11-20T10:02:00.000Z',
            lastFailureAt: '2026-11-20T11:02:00.000Z',
            lastError: 'Database unavailable',
            consecutiveFailures: 1
        });

        const rows = await loadJobRuns();

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            jobName: '1h',
            lastFailureAt: '2026-11-20T11:02:00.000Z',
            lastError: 'Database unavailable',
            consecutiveFailures: 1
        });
    });

    test('keeps separate rows for separate jobs', async () => {
        const state = {
            lastSuccessAt: '2026-11-20T11:00:00.000Z',
            lastFailureAt: null,
            lastError: null,
            consecutiveFailures: 0
        };

        await saveJobRun('5m', state);
        await saveJobRun('cleanup', state);

        const names = (await loadJobRuns()).map((row) => row.jobName).sort();

        expect(names).toEqual(['5m', 'cleanup']);
    });
});