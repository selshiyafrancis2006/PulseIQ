const { getPrometheusMetrics } = require('../services/prometheus.service');

const scrapePrometheusMetrics = async (req, res) => {
    try {
        const { contentType, body } = await getPrometheusMetrics();

        res.set('Content-Type', contentType);
        return res.status(200).send(body);
    } catch (err) {
        console.error('Prometheus metrics scrape failed:', err);

        return res.status(500).json({
            error: 'Unable to collect Prometheus metrics'
        });
    }
};

module.exports = { scrapePrometheusMetrics };
