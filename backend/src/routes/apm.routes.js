const express = require('express');
const router = express.Router();

const {
    getTraces,
    getRouteSummary
} = require('../controllers/apm.controller');

router.get('/traces', getTraces);
router.get('/traces/summary', getRouteSummary);

module.exports = router;