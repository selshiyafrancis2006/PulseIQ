const express = require('express');
const router = express.Router();

const {
    getTraces,
    getRouteSummary,
    getOverview,
    getTimeSeries
} = require('../controllers/apm.controller');

router.get('/traces', getTraces);
router.get('/traces/summary', getRouteSummary);
router.get('/traces/overview', getOverview);
router.get('/traces/timeseries', getTimeSeries);

module.exports = router;