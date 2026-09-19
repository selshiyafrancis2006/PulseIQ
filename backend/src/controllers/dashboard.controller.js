const dashboardService = require('../services/dashboard.service');

const listDashboards = async (req, res) => {
    try {

        const dashboards = await dashboardService.fetchDashboards(req.user.id);
        res.json(dashboards);

    } catch (err) {
        console.error('Failed to fetch dashboards:', err);
        res.status(500).json({ error: 'Failed to fetch dashboards' });
    }
};

const getDashboard = async (req, res) => {
    try {

        const dashboard = await dashboardService.fetchDashboardById(req.params.id, req.user.id);

        if (!dashboard) {
            return res.status(404).json({ error: 'Dashboard not found' });
        }

        res.json(dashboard);

    } catch (err) {
        console.error('Failed to fetch dashboard:', err);
        res.status(500).json({ error: 'Failed to fetch dashboard' });
    }
};

const createDashboard = async (req, res) => {
    try {

        const { name } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Dashboard name is required' });
        }

        const dashboard = await dashboardService.createDashboard(req.user.id, name.trim());
        res.status(201).json(dashboard);

    } catch (err) {
        console.error('Failed to create dashboard:', err);
        res.status(500).json({ error: 'Failed to create dashboard' });
    }
};

const renameDashboard = async (req, res) => {
    try {

        const { name } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Dashboard name is required' });
        }

        const dashboard = await dashboardService.renameDashboard(req.params.id, req.user.id, name.trim());

        if (!dashboard) {
            return res.status(404).json({ error: 'Dashboard not found' });
        }

        res.json(dashboard);

    } catch (err) {
        console.error('Failed to rename dashboard:', err);
        res.status(500).json({ error: 'Failed to rename dashboard' });
    }
};

const updateLayout = async (req, res) => {
    try {

        const { layout } = req.body;

        if (!Array.isArray(layout)) {
            return res.status(400).json({ error: 'layout must be an array' });
        }

        const dashboard = await dashboardService.updateLayout(req.params.id, req.user.id, layout);

        if (!dashboard) {
            return res.status(404).json({ error: 'Dashboard not found' });
        }

        res.json(dashboard);

    } catch (err) {
        console.error('Failed to update dashboard layout:', err);
        res.status(500).json({ error: 'Failed to update dashboard layout' });
    }
};

const deleteDashboard = async (req, res) => {
    try {

        const deleted = await dashboardService.deleteDashboard(req.params.id, req.user.id);

        if (!deleted) {
            return res.status(404).json({ error: 'Dashboard not found' });
        }

        res.status(204).send();

    } catch (err) {
        console.error('Failed to delete dashboard:', err);
        res.status(500).json({ error: 'Failed to delete dashboard' });
    }
};

module.exports = {
    listDashboards,
    getDashboard,
    createDashboard,
    renameDashboard,
    updateLayout,
    deleteDashboard
};