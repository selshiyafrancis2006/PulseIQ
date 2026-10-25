
const SLO_TARGET_PERCENT = 99.9;
const WINDOW_MINUTES = 30 * 24 * 60;
const ALLOWED_DOWNTIME_MINUTES = Number(
    (WINDOW_MINUTES * (1 - SLO_TARGET_PERCENT / 100)).toFixed(2)
);

function calculateSlo(events, options = {}) {
    const now = options.now ? new Date(options.now) : new Date();
    const windowStart = new Date(
        now.getTime() - WINDOW_MINUTES * 60 * 1000
    );

    const orderedEvents = [...events]
        .map(event => ({
            ...event,
            created_at: new Date(event.created_at)
        }))
        .filter(event =>
            ['UP', 'DOWN'].includes(event.type) &&
            !Number.isNaN(event.created_at.getTime()) &&
            event.created_at <= now
        )
        .sort((a, b) => a.created_at - b.created_at);

    const previousEvent = orderedEvents
        .filter(event => event.created_at < windowStart)
        .at(-1);

    const windowEvents = orderedEvents.filter(
        event => event.created_at >= windowStart
    );

    const baseResult = {
        target_percent: SLO_TARGET_PERCENT,
        allowed_downtime_minutes: ALLOWED_DOWNTIME_MINUTES,
        observed_downtime_minutes: null,
        remaining_budget_minutes: null,
        status: 'insufficient_data'
    };

    // We need a known state at the window boundary.
    // A DOWN event inside the window can establish an outage start,
    // but an UP event alone cannot establish the earlier state.
    if (!previousEvent) {
        if (windowEvents.length === 0 || windowEvents[0].type !== 'DOWN') {
            return baseResult;
        }
    }

    let state = previousEvent?.type ?? null;
    let observedDowntimeMs = 0;
    let outageStart = state === 'DOWN' ? windowStart : null;

    for (const event of windowEvents) {
        if (event.type === 'DOWN' && state !== 'DOWN') {
            state = 'DOWN';
            outageStart = event.created_at;
        } else if (event.type === 'UP' && state === 'DOWN') {
            observedDowntimeMs +=
                event.created_at.getTime() - outageStart.getTime();
            outageStart = null;
            state = 'UP';
        } else {
            state = event.type;
        }
    }

    if (state === 'DOWN' && outageStart) {
        observedDowntimeMs +=
            now.getTime() - outageStart.getTime();
    }

    const observedDowntimeMinutes = Number(
        (observedDowntimeMs / 60000).toFixed(2)
    );

    const remainingBudgetMinutes = Number(
        Math.max(
            0,
            ALLOWED_DOWNTIME_MINUTES - observedDowntimeMinutes
        ).toFixed(2)
    );

    return {
        ...baseResult,
        observed_downtime_minutes: observedDowntimeMinutes,
        remaining_budget_minutes: remainingBudgetMinutes,
        status: observedDowntimeMinutes >= ALLOWED_DOWNTIME_MINUTES
            ? 'exhausted'
            : 'within_budget'
    };
}

module.exports = {
    calculateSlo,
    SLO_TARGET_PERCENT,
    WINDOW_MINUTES,
    ALLOWED_DOWNTIME_MINUTES
};
