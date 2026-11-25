const express = require('express');
const metricsQueryLimiter = require('../middleware/metricsQueryRateLimit.middleware');
const requireAdmin = require('../middleware/requireAdmin.middleware');

const {
    getMetricRollupHealth
} = require('../controllers/metricRollupHealth.controller');

const {
    getCustomMetricsQuery,
    getCustomMetricNames
} = require('../controllers/customMetrics.controller');

const router = express.Router();

const {
    getMetrics,
    getLatestMetric,
    getMetricsQuery
} = require('../controllers/metrics.controller');

router.get('/metrics/rollup-health', requireAdmin, getMetricRollupHealth);

router.get('/metrics/query', metricsQueryLimiter, getMetricsQuery);
router.get('/metrics/custom', metricsQueryLimiter, getCustomMetricsQuery);
router.get('/metrics/custom/names', metricsQueryLimiter, getCustomMetricNames);

router.get('/metrics', getMetrics);

router.get(
    '/metrics/latest',
    getLatestMetric
);

module.exports = router;


