const pool = require('../config/db');

// Saves the outcome of a background job so it survives a backend restart.
// Failing to save must never break the job itself, so errors are only logged.
async function saveJobRun(jobName, state) {
    try {
        await pool.query(
            `INSERT INTO job_runs (
                job_name,
                last_success_at,
                last_failure_at,
                last_error,
                consecutive_failures
            )
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (job_name) DO UPDATE SET
                last_success_at = EXCLUDED.last_success_at,
                last_failure_at = EXCLUDED.last_failure_at,
                last_error = EXCLUDED.last_error,
                consecutive_failures = EXCLUDED.consecutive_failures`,
            [
                jobName,
                state.lastSuccessAt,
                state.lastFailureAt,
                state.lastError,
                state.consecutiveFailures
            ]
        );
    } catch (err) {
        console.error(`Could not save the run state of job "${jobName}":`, err.message);
    }
}

async function loadJobRunsStrict() {
    const result = await pool.query(
        `SELECT job_name, last_success_at, last_failure_at, last_error, consecutive_failures
         FROM job_runs`
    );

    return result.rows.map((row) => ({
        jobName: row.job_name,
        lastSuccessAt: row.last_success_at ? row.last_success_at.toISOString() : null,
        lastFailureAt: row.last_failure_at ? row.last_failure_at.toISOString() : null,
        lastError: row.last_error,
        consecutiveFailures: row.consecutive_failures
    }));
}

async function loadJobRuns() {
    try {
        return await loadJobRunsStrict();
    } catch (err) {
        console.error('Could not load saved job run state:', err.message);
        return [];
    }
}

module.exports = { saveJobRun, loadJobRuns, loadJobRunsStrict };
