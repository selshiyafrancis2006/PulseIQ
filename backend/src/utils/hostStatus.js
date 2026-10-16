// Single source of truth for host status.
// pending = never reported, online = recent heartbeat, offline = stale heartbeat.

const OFFLINE_THRESHOLD_SECONDS = Math.max(
    30,
    Number.parseInt(process.env.OFFLINE_THRESHOLD_SECONDS, 10) || 30
);

// SQL CASE expression. `alias` is the hosts table alias, `paramIndex` is the
// placeholder number that will hold OFFLINE_THRESHOLD_SECONDS.
function statusSql(alias, paramIndex) {
    return `CASE
        WHEN ${alias}.last_seen_at IS NULL THEN 'pending'
        WHEN ${alias}.last_seen_at < NOW() - ($${paramIndex}::int * INTERVAL '1 second') THEN 'offline'
        ELSE 'online'
    END`;
}

module.exports = { OFFLINE_THRESHOLD_SECONDS, statusSql };