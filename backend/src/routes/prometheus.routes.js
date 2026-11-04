const express = require('express');
const router = express.Router();

const authenticatePrometheus = require('../middleware/prometheusAuth.middleware');
const {
    scrapePrometheusMetrics
} = require('../controllers/prometheus.controller');

router.get('/', authenticatePrometheus, scrapePrometheusMetrics);

module.exports = router;
