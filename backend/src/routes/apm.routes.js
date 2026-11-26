const express = require('express');
const router = express.Router();

const {
    getTraces,
    getRouteSummary,
    getOverview,
    getTimeSeries,
    getRouteDetail
} = require('../controllers/apm.controller');

router.get('/traces', getTraces);
router.get('/traces/summary', getRouteSummary);
router.get('/traces/overview', getOverview);
router.get('/traces/timeseries', getTimeSeries);
router.get('/routes/detail', getRouteDetail);

module.exports = router;