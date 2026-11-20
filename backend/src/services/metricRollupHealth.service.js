// '5m' and '1h' are the metric rollups; 'cleanup' is the daily retention job.
const JOB_NAMES = ['5m', '1h', 'cleanup'];

const STALE_AFTER_MS = {
    '5m': 15 * 60 * 1000,
    '1h': 90 * 60 * 1000,
    // Runs once a day at 03:00, so allow a little over a day.
    cleanup: 26 * 60 * 60 * 1000
};

const jobs = Object.fromEntries(
    JOB_NAMES.map((name) => [
        name,
        {
            lastSuccessAt: null,
            lastFailureAt: null,
            lastError: null,
            consecutiveFailures: 0
        }
    ])
);

function recordRollupSuccess(jobName, completedAt = new Date()) {
    if (!jobs[jobName]) {
        throw new Error(`Unknown metric rollup job: ${jobName}`);
    }

    jobs[jobName] = {
        ...jobs[jobName],
        lastSuccessAt: completedAt.toISOString(),
        lastError: null,
        consecutiveFailures: 0
    };
}

function recordRollupFailure(jobName, error, failedAt = new Date()) {
    if (!jobs[jobName]) {
        throw new Error(`Unknown metric rollup job: ${jobName}`);
    }

    jobs[jobName] = {
        ...jobs[jobName],
        lastFailureAt: failedAt.toISOString(),
        lastError: error instanceof Error ? error.message : String(error),
        consecutiveFailures: jobs[jobName].consecutiveFailures + 1
    };
}

function getJobState(jobName) {
    if (!jobs[jobName]) {
        throw new Error(`Unknown metric rollup job: ${jobName}`);
    }

    return { ...jobs[jobName] };
}

const validDateOrNull = (value) => {
    if (value === null || value === undefined) return null;

    const time = Date.parse(value);

    return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

// Loads the state saved by an earlier run of the backend, so a restart does
// not make every job look like it has never succeeded. A job that has already
// run in this process is left alone, and unknown or malformed rows are ignored.
function hydrateRollupHealth(rows) {
    if (!Array.isArray(rows)) return;

    for (const row of rows) {
        const state = row && jobs[row.jobName];

        if (!state || state.lastSuccessAt !== null || state.lastFailureAt !== null) {
            continue;
        }

        const failures = Number(row.consecutiveFailures);

        jobs[row.jobName] = {
            lastSuccessAt: validDateOrNull(row.lastSuccessAt),
            lastFailureAt: validDateOrNull(row.lastFailureAt),
            lastError: typeof row.lastError === 'string' ? row.lastError : null,
            consecutiveFailures: Number.isInteger(failures) && failures >= 0 ? failures : 0
        };
    }
}

function getJobHealth(jobName, state, now) {
    const staleAfterMs = STALE_AFTER_MS[jobName];
    const lastSuccessMs = state.lastSuccessAt
        ? Date.parse(state.lastSuccessAt)
        : null;

    const ageMs = lastSuccessMs === null
        ? null
        : Math.max(0, now.getTime() - lastSuccessMs);

    const healthy = ageMs !== null && ageMs <= staleAfterMs;

    return {
        ...state,
        healthy,
        status: ageMs === null
            ? 'never_succeeded'
            : healthy
                ? 'healthy'
                : 'stale',
        staleAfterSeconds: staleAfterMs / 1000,
        lastSuccessAgeSeconds: ageMs === null
            ? null
            : Math.floor(ageMs / 1000)
    };
}

function getRollupHealth(now = new Date()) {
    return {
        checkedAt: now.toISOString(),
        jobs: Object.fromEntries(
            Object.entries(jobs).map(([name, state]) => [
                name,
                getJobHealth(name, state, now)
            ])
        )
    };
}

module.exports = {
    STALE_AFTER_MS,
    recordRollupSuccess,
    recordRollupFailure,
    getJobState,
    hydrateRollupHealth,
    getRollupHealth
};