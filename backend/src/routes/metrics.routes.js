const express = require('express');
const metricsQueryLimiter = require('../middleware/metricsQueryRateLimit.middleware');
const {
    getMetricRollupHealth
} = require('../controllers/metricRollupHealth.controller');

const router = express.Router();

const {
    getMetrics,
    getLatestMetric,
    getMetricsQuery
} = require('../controllers/metrics.controller');

router.get('/metrics/rollup-health', getMetricRollupHealth);

router.get('/metrics/query', metricsQueryLimiter, getMetricsQuery);

router.get('/metrics', getMetrics);

router.get(
    '/metrics/latest',
    getLatestMetric
);

module.exports = router;
