const metricsService = require('../services/metrics.service');

const customMetricsQueryService =
    require('../services/customMetricsQuery.service');

const { RAW_RETENTION_DAYS } =
    require('../services/metricRollup.service');

const MAX_QUERY_WINDOW_MS =
    RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function parseHostId(value) {
    if (
        typeof value !== 'string' ||
        !/^[1-9]\d*$/.test(value)
    ) {
        return null;
    }

    const id = Number(value);

    return Number.isSafeInteger(id) ? id : null;
}

function parseIsoTimestamp(value) {
    if (typeof value !== 'string') return null;

    const match = value.match(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/
    );

    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    const offsetHour = Number(match[9] || 0);
    const offsetMinute = Number(match[10] || 0);

    const leapYear =
        year % 4 === 0 &&
        (year % 100 !== 0 || year % 400 === 0);

    const daysInMonth = [
        31, leapYear ? 29 : 28, 31, 30, 31, 30,
        31, 31, 30, 31, 30, 31
    ];

    if (
        year < 1 ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > daysInMonth[month - 1] ||
        hour > 23 ||
        minute > 59 ||
        second > 59 ||
        offsetHour > 23 ||
        offsetMinute > 59
    ) {
        return null;
    }

    const timestamp = new Date(value);

    return Number.isNaN(timestamp.getTime())
        ? null
        : timestamp;
}

const getCustomMetricsQuery = async (req, res) => {
    try {
        const hostId = parseHostId(req.query.host_id);
        const { metric_name: metricName, step, agg } = req.query;

        const from = parseIsoTimestamp(req.query.from);
        const to = parseIsoTimestamp(req.query.to);

        if (!hostId) {
            return res.status(400).json({
                error: 'A valid host_id is required'
            });
        }

        if (
            typeof metricName !== 'string' ||
            !/^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/.test(metricName)
        ) {
            return res.status(400).json({
                error: 'A valid metric_name is required'
            });
        }

        if (!from || !to || from >= to) {
            return res.status(400).json({
                error: 'Valid from and to ISO timestamps are required, and from must be before to'
            });
        }

        const now = Date.now();

        if (to.getTime() > now) {
            return res.status(400).json({
                error: 'The to timestamp cannot be in the future'
            });
        }

        const oldestAvailableTimestamp =
            now - MAX_QUERY_WINDOW_MS;

        if (from.getTime() < oldestAvailableTimestamp) {
            return res.status(400).json({
                error: `The from timestamp exceeds the ${RAW_RETENTION_DAYS}-day custom metrics retention limit`
            });
        }

        if (
            to.getTime() - from.getTime() >
            MAX_QUERY_WINDOW_MS
        ) {
            return res.status(400).json({
                error: `The maximum custom metrics query window is ${RAW_RETENTION_DAYS} days`
            });
        }

        if (
            !Object.prototype.hasOwnProperty.call(
                customMetricsQueryService.QUERY_STEPS,
                step
            )
        ) {
            return res.status(400).json({
                error: 'Invalid step. Supported steps: 1m, 5m, 15m, 1h, 6h, 1d'
            });
        }

        if (
            !Object.prototype.hasOwnProperty.call(
                customMetricsQueryService.AGGREGATIONS,
                agg
            )
        ) {
            return res.status(400).json({
                error: 'Invalid aggregation. Supported aggregations: avg, min, max'
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

        const data =
            await customMetricsQueryService.fetchCustomMetricQuery({
                hostId,
                metricName,
                from,
                to,
                step,
                aggregation: agg
            });

        if (
            data.length >
            customMetricsQueryService.MAX_CUSTOM_QUERY_ROWS
        ) {
            return res.status(413).json({
                error: 'Custom metrics query returned too many rows. Use a larger step or narrower time range.'
            });
        }

        return res.json({
            host_id: hostId,
            metric_name: metricName,
            from: from.toISOString(),
            to: to.toISOString(),
            step,
            aggregation: agg,
            data
        });
    } catch (err) {
        console.error('Custom metrics query error:', err);

        return res.status(500).json({
            error: 'Failed to fetch custom metrics'
        });
    }
};


const getCustomMetricNames = async (req, res) => {
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

        const metrics =
            await customMetricsQueryService.fetchCustomMetricNames(hostId);

        return res.json({
            host_id: hostId,
            metrics
        });
    } catch (err) {
        console.error('Custom metric names error:', err);

        return res.status(500).json({
            error: 'Failed to fetch custom metric names'
        });
    }
};
module.exports = {
    getCustomMetricsQuery,
    getCustomMetricNames
};


