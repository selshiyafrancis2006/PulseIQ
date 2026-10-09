const metricsService =
    require('../services/metrics.service');

function parseHostId(value) {

    const id = Number(value);

    return Number.isInteger(id) && id > 0 ? id : null;

}

const getMetrics = async (req, res) => {

    try {

        const range =
            req.query.range || '1m';

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

module.exports = {
    getMetrics,
    getLatestMetric
};