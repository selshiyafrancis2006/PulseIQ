const JOB_NAMES = ['5m', '1h'];

const STALE_AFTER_MS = {
    '5m': 15 * 60 * 1000,
    '1h': 90 * 60 * 1000
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
    getRollupHealth
};
