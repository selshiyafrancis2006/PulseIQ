const db = require('../config/db');

async function evaluateMonitorQuorum(monitor, centralResult) {
    const quorum = Number(monitor.quorum ?? 1);

    // Preserve the existing single-check behavior for the default quorum.
    if (quorum === 1) {
        return centralResult;
    }

    const intervalSeconds = Number(monitor.interval_seconds ?? 30);
    const freshnessSeconds = Math.max(
        60,
        Number.isFinite(intervalSeconds) && intervalSeconds > 0
            ? intervalSeconds * 2
            : 60
    );

    // Each assigned agent contributes at most its latest fresh result.
    const locations = await db.query(
        `SELECT ml.host_id, latest.status
         FROM monitor_locations ml
         LEFT JOIN LATERAL (
             SELECT r.status
             FROM monitor_location_results r
             WHERE r.monitor_id = ml.monitor_id
               AND r.host_id = ml.host_id
               AND r.checked_at >= NOW() - ($2 * INTERVAL '1 second')
             ORDER BY r.checked_at DESC, r.id DESC
             LIMIT 1
         ) latest ON TRUE
         WHERE ml.monitor_id = $1`,
        [monitor.id, freshnessSeconds]
    );

    const votes = [centralResult.status];

    for (const location of locations.rows) {
        if (location.status === 'UP' || location.status === 'DOWN') {
            votes.push(location.status);
        }
    }

    const upVotes = votes.filter(status => status === 'UP').length;
    const downVotes = votes.filter(status => status === 'DOWN').length;

    const downQuorumReached = downVotes >= quorum;
    const upQuorumReached = upVotes >= quorum;

    // Conflicting quorums are inconclusive; never resolve a tie by priority.
    if (downQuorumReached && upQuorumReached) {
        return null;
    }

    if (downQuorumReached) {
        return {
            ...centralResult,
            status: 'DOWN',
            errorType: centralResult.status === 'DOWN'
                ? centralResult.errorType
                : 'QUORUM_DOWN',
            errorMessage: centralResult.status === 'DOWN'
                ? centralResult.errorMessage
                : `Quorum reached: ${downVotes} DOWN vote(s), ${upVotes} UP vote(s)`
        };
    }

    if (upQuorumReached) {
        return {
            ...centralResult,
            status: 'UP',
            errorType: null,
            errorMessage: null
        };
    }

    // Not enough matching votes: do not claim a new status.
    return null;
}

module.exports = { evaluateMonitorQuorum };

