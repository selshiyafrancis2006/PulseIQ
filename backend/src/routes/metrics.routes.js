const express = require('express');

const router = express.Router();

const {
    getMetrics,
    getLatestMetric
} = require('../controllers/metrics.controller');

router.get('/metrics', getMetrics);

router.get(
    '/metrics/latest',
    getLatestMetric
);

module.exports = router;