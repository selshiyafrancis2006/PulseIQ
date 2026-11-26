const apmService = require('../services/apm.service');
const { resolveApmRange, APM_RANGES } = require('../utils/apmRange');

// Shared request checks. Returns { hostId, range } or null once it has
// already sent the error response.
const parseRequest = async (req, res, { needsRange }) => {

    const hostId = req.query.host_id;

    if (!hostId) {
        res.status(400).json({ error: 'host_id is required' });
        return null;
    }

    let range = null;

    if (needsRange) {
        range = resolveApmRange(req.query.range);

        if (!range) {
            res.status(400).json({
                error: `range must be one of: ${Object.keys(APM_RANGES).join(', ')}`
            });
            return null;
        }
    }

    const owns = await apmService.verifyHostOwnership(hostId, req.user.id);

    if (!owns) {
        res.status(404).json({ error: 'Host not found' });
        return null;
    }

    return { hostId, range };
};

const getTraces = async (req, res) => {
    try {

        const parsed = await parseRequest(req, res, { needsRange: false });
        if (!parsed) return;

        const traces = await apmService.fetchTraces(parsed.hostId);

        res.json(traces);

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: 'Failed to fetch traces'
        });
    }
};

const getRouteSummary = async (req, res) => {
    try {

        const parsed = await parseRequest(req, res, { needsRange: true });
        if (!parsed) return;

        const summary = await apmService.fetchRouteSummary(
            parsed.hostId,
            parsed.range.seconds
        );

        res.json(summary);

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: 'Failed to fetch route summary'
        });
    }
};

const getOverview = async (req, res) => {
    try {

        const parsed = await parseRequest(req, res, { needsRange: true });
        if (!parsed) return;

        const overview = await apmService.fetchOverview(
            parsed.hostId,
            parsed.range.seconds
        );

        res.json({ range: parsed.range.key, ...overview });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: 'Failed to fetch APM overview'
        });
    }
};

const getTimeSeries = async (req, res) => {
    try {

        const parsed = await parseRequest(req, res, { needsRange: true });
        if (!parsed) return;

        const points = await apmService.fetchTimeSeries(
            parsed.hostId,
            parsed.range.seconds,
            parsed.range.bucketSeconds
        );

        res.json({
            range: parsed.range.key,
            bucket_seconds: parsed.range.bucketSeconds,
            points
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: 'Failed to fetch APM time series'
        });
    }
};

module.exports = {
    getTraces,
    getRouteSummary,
    getOverview,
    getTimeSeries
};