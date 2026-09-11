const express = require('express');
const router = express.Router();

const { getAnomalies } = require('../controllers/anomaly.controller');

router.get('/', getAnomalies);

module.exports = router;