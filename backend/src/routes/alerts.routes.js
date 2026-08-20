const express = require('express');
const router = express.Router();

const {
    getAlerts,
    getRules,
    putRule
} = require('../controllers/alerts.controller');

router.get('/alerts', getAlerts);

router.get('/alert-rules', getRules);

router.put('/alert-rules/:id', putRule);

module.exports = router;