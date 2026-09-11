const apmService = require('../services/apm.service');

const getTraces = async (req, res) => {
    try {

        const hostId = req.query.host_id;

        if (!hostId) {
            return res.status(400).json({
                error: 'host_id is required'
            });
        }

        const owns = await apmService.verifyHostOwnership(hostId, req.user.id);

        if (!owns) {
            return res.status(404).json({
                error: 'Host not found'
            });
        }

        const traces = await apmService.fetchTraces(hostId);

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

        const hostId = req.query.host_id;

        if (!hostId) {
            return res.status(400).json({
                error: 'host_id is required'
            });
        }

        const owns = await apmService.verifyHostOwnership(hostId, req.user.id);

        if (!owns) {
            return res.status(404).json({
                error: 'Host not found'
            });
        }

        const summary = await apmService.fetchRouteSummary(hostId);

        res.json(summary);

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: 'Failed to fetch route summary'
        });
    }
};

module.exports = {
    getTraces,
    getRouteSummary
};