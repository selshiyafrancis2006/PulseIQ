const anomalyService = require('../services/anomaly.service');

const getAnomalies = async (req, res) => {
    try {

        const hostId = req.query.host_id;

        if (!hostId) {
            return res.status(400).json({
                error: 'host_id is required'
            });
        }

        const owns = await anomalyService.verifyHostOwnership(hostId, req.user.id);

        if (!owns) {
            return res.status(404).json({
                error: 'Host not found'
            });
        }

        const anomalies = await anomalyService.fetchAnomalies(hostId);

        res.json(anomalies);

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: 'Failed to fetch anomalies'
        });
    }
};

module.exports = {
    getAnomalies
};