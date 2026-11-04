const metricsService =
    require('../services/metrics.service');

const metricsQueryService =
    require('../services/metricsQuery.service');

const { ROLLUP_1H_RETENTION_DAYS } = require('../services/metricRollup.service');

const MAX_QUERY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

const parseHostIds = (value) => {
    if (typeof value !== 'string' || !value.trim()) {
        return null;
    }

    const parts = value.split(',');
    const ids = parts.map((part) => {
        const trimmed = part.trim();

        if (!/^[1-9]\d*$/.test(trimmed)) {
            return null;
        }

        const id = Number(trimmed);

        return Number.isSafeInteger(id) ? id : null;
    });

    if (ids.some((id) => id === null)) {
        return null;
    }

    if (new Set(ids).size !== ids.length) {
        return null;
    }

    return ids;
};

const parseIsoTimestamp = (value) => {
    if (
        typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ) {
        return null;
    }

    const timestamp = new Date(value);

    return Number.isNaN(timestamp.getTime()) ? null : timestamp;
};

function parseHostId(value) {

    const id = Number(value);

    return Number.isInteger(id) && id > 0 ? id : null;

}

const getMetrics = async (req, res) => {

    try {

        const range = req.query.range || '1m';

        if (!metricsService.isSupportedRange(range)) {
            return res.status(400).json({
                error: 'Invalid range. Supported ranges: 1m, 5m, 15m, 1h, 6h, 24h, 3d, 7d, 30d, 90d'
            });
        }

        const hostId = parseHostId(req.query.host_id);

        if (!hostId) {
            return res.status(400).json({
                error: 'A valid host_id is required'
            });
        }

        const owns = await metricsService.verifyHostOwnership(
            hostId,
            req.user.id
        );

        if (!owns) {
            return res.status(404).json({
                error: 'Host not found'
            });
        }

        const metrics =
            await metricsService.fetchMetrics(range, hostId);

        res.json(metrics);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: 'Failed to fetch metrics'
        });

    }

};

const getLatestMetric = async (req, res) => {

    try {

        const hostId = parseHostId(req.query.host_id);

        if (!hostId) {
            return res.status(400).json({
                error: 'A valid host_id is required'
            });
        }

        const owns = await metricsService.verifyHostOwnership(
            hostId,
            req.user.id
        );

        if (!owns) {
            return res.status(404).json({
                error: 'Host not found'
            });
        }

        const metric =
            await metricsService.fetchLatestMetric(hostId);

        res.json(metric || null);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: 'Failed to fetch latest metric'
        });

    }

};

const getMetricsQuery = async (req, res) => {
    try {
        const hostIds = parseHostIds(req.query.host_ids);
        const from = parseIsoTimestamp(req.query.from);
        const to = parseIsoTimestamp(req.query.to);
        const { step, agg } = req.query;

        if (!hostIds) {
            return res.status(400).json({
                error: 'Valid comma-separated host_ids are required'
            });
        }

        if (!from || !to || from >= to) {
            return res.status(400).json({
                error: 'Valid from and to ISO timestamps are required, and from must be before to'
            });
        }

        if (to.getTime() > Date.now()) {
            return res.status(400).json({
                error: 'The to timestamp cannot be in the future'
            });
        }

        const oldestAvailableTimestamp =
            Date.now() - ROLLUP_1H_RETENTION_DAYS * 24 * 60 * 60 * 1000;

        if (from.getTime() < oldestAvailableTimestamp) {
            return res.status(400).json({
                error: `The from timestamp exceeds the ${ROLLUP_1H_RETENTION_DAYS}-day metrics retention limit`
            });
        }
        if (to.getTime() - from.getTime() > MAX_QUERY_WINDOW_MS) {
            return res.status(400).json({
                error: 'The maximum query window is 90 days'
            });
        }

        if (!Object.prototype.hasOwnProperty.call(
            metricsQueryService.QUERY_STEPS,
            step
        )) {
            return res.status(400).json({
                error: 'Unsupported step. Supported steps: 1m, 5m, 15m, 1h, 6h, 1d'
            });
        }

        if (!['avg', 'min', 'max', 'p95'].includes(agg)) {
            return res.status(400).json({
                error: 'Unsupported aggregation. Supported aggregations: avg, min, max, p95'
            });
        }

        const sources = metricsQueryService.getQuerySources(from, to);

        if (sources.length === 0) {
            return res.status(400).json({
                error: 'No metric data source is available for this query range'
            });
        }

        const coarsestSource = sources.reduce((coarsest, segment) => {
            return segment.source.resolutionMs > coarsest.resolutionMs
                ? segment.source
                : coarsest;
        }, sources[0].source);

        if (agg === 'p95' && sources.some(
            (segment) => segment.source.type !== 'raw'
        )) {
            return res.status(400).json({
                error: 'P95 aggregation is only supported for raw metrics within the last 3 days'
            });
        }

        if (!metricsQueryService.isStepCompatible(step, coarsestSource)) {
            return res.status(400).json({
                error: `Step ${step} is too small for the selected ${coarsestSource.type} data resolution`
            });
        }

        if (
            from.getTime() % coarsestSource.resolutionMs !== 0 ||
            to.getTime() % coarsestSource.resolutionMs !== 0
        ) {
            const boundaryLabel = coarsestSource.type === '1h'
                ? 'hourly'
                : '5-minute';

            return res.status(400).json({
                error: `from and to must align to ${boundaryLabel} UTC boundaries for this query range`
            });
        }

        const ownsAllHosts =
            await metricsQueryService.verifyHostsOwnership(
                hostIds,
                req.user.id
            );

        if (!ownsAllHosts) {
            return res.status(404).json({
                error: 'One or more hosts not found'
            });
        }

        const data = await metricsQueryService.fetchMetricQuery({
            hostIds,
            from,
            to,
            step,
            agg,
            sources
        });

        return res.json({
            from: from.toISOString(),
            to: to.toISOString(),
            step,
            agg,
            data
        });
    } catch (err) {
        console.error(err);

        return res.status(500).json({
            error: 'Failed to query metrics'
        });
    }
};
module.exports = {
    getMetrics,
    getLatestMetric,
    getMetricsQuery
};