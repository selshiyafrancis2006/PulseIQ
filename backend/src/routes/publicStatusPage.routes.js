const express = require('express');
const { getPublicPage } = require('../controllers/statusPage.controller');
const { getPublicIncidents } = require('../controllers/publicStatusIncident.controller');

const router = express.Router();

router.get('/:slug/incidents', getPublicIncidents);
router.get('/:slug', getPublicPage);

module.exports = router;
