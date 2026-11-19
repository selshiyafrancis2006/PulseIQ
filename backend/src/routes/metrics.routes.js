const express = require('express');
const metricsQueryLimiter = require('../middleware/metricsQueryRateLimit.middleware');

const router = express.Router();

const {
    getMetrics,
    getLatestMetric,
    getMetricsQuery
} = require('../controllers/metrics.controller');

router.get('/metrics/query', metricsQueryLimiter, getMetricsQuery);

router.get('/metrics', getMetrics);

router.get(
    '/metrics/latest',
    getLatestMetric
);

module.exports = router;
