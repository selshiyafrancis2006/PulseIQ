const metricsService =
    require('../services/metrics.service');

const getMetrics = async (req, res) => {

    try {

        const range =
            req.query.range || '1m';

        const metrics =
            await metricsService.fetchMetrics(range);

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

        const metric =
            await metricsService.fetchLatestMetric();

        res.json(metric);

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