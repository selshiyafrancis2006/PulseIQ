const express = require('express');
const router = express.Router();

const {
    getAlerts,
    getRules,
    postRule,
    putRule,
    deleteRuleController,
    postAcknowledgeAlert
} = require('../controllers/alerts.controller');

router.get('/alerts', getAlerts);
router.post('/alerts/:id/acknowledge', postAcknowledgeAlert);

router.get('/alert-rules', getRules);
router.post('/alert-rules', postRule);

router.put('/alert-rules/:id', putRule);
router.delete('/alert-rules/:id', deleteRuleController);

module.exports = router;
