const express = require('express');
const { getPublicPage } = require('../controllers/statusPage.controller');

const router = express.Router();
router.get('/:slug', getPublicPage);

module.exports = router;
