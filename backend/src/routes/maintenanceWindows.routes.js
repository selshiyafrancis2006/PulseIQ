const express = require('express');
const router = express.Router();

const {
    createWindow,
    listWindows,
    endWindow,
    deleteWindow
} = require('../controllers/maintenanceWindows.controller');

router.get('/', listWindows);
router.post('/', createWindow);
router.post('/:id/end', endWindow);
router.delete('/:id', deleteWindow);

module.exports = router;