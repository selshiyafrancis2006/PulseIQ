const { getRollupHealth } = require('../services/metricRollupHealth.service');

function getMetricRollupHealth(req, res) {
    return res.json(getRollupHealth());
}

module.exports = { getMetricRollupHealth };
