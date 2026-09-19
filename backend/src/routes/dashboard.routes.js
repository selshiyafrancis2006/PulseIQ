const express = require('express');
const router = express.Router();

const {
    listDashboards,
    getDashboard,
    createDashboard,
    renameDashboard,
    updateLayout,
    deleteDashboard
} = require('../controllers/dashboard.controller');

router.get('/', listDashboards);
router.get('/:id', getDashboard);
router.post('/', createDashboard);
router.patch('/:id', renameDashboard);
router.put('/:id/layout', updateLayout);
router.delete('/:id', deleteDashboard);

module.exports = router;