const express = require('express');
const router = express.Router();

const {
    getAlerts,
    getRules,
    putRule,
    postAcknowledgeAlert
} = require('../controllers/alerts.controller');

router.get('/alerts', getAlerts);
router.post('/alerts/:id/acknowledge', postAcknowledgeAlert);

router.get('/alert-rules', getRules);

router.put('/alert-rules/:id', putRule);

module.exports = router;
