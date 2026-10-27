const express = require('express');
const controller = require('../controllers/apiTest.controller');

const router = express.Router();

router.get('/', controller.listApiTests);
router.post('/', controller.createApiTest);
router.get('/:id/runs', controller.listApiTestRuns);
router.post('/:id/run', controller.executeApiTest);
router.get('/:id', controller.getApiTest);
router.patch('/:id', controller.updateApiTest);
router.delete('/:id', controller.deleteApiTest);

module.exports = router;
