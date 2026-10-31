const express = require('express');
const { getConfig, updateConfig } = require('../controllers/statusPage.controller');
const {
    getIncidents,
    createIncident,
    addIncidentUpdate
} = require('../controllers/statusPageIncident.controller');

const router = express.Router();

router.get('/', getConfig);
router.put('/', updateConfig);

router.get('/incidents', getIncidents);
router.post('/incidents', createIncident);
router.post('/incidents/:id/updates', addIncidentUpdate);

module.exports = router;
