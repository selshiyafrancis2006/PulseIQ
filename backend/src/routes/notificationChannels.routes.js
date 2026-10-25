const express = require('express');
const router = express.Router();

const {
    listChannels,
    createChannel,
    updateChannel,
    deleteChannel,
    testChannel
} = require('../controllers/notificationChannels.controller');

router.get('/', listChannels);
router.post('/', createChannel);
router.patch('/:id', updateChannel);
router.delete('/:id', deleteChannel);
router.post('/:id/test', testChannel);

module.exports = router;