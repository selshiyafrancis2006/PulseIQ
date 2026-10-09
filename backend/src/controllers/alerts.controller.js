const { fetchAlerts, fetchRules, updateRule } = require('../services/alert.service');

const getAlerts = async (req, res) => {
    try {
        const { host_id } = req.query;

        if (!host_id) {
            return res.status(400).json({ error: 'host_id is required' });
        }

        const alerts = await fetchAlerts(host_id, req.user.id);
        res.json(alerts);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch alerts' });
    }
};

const getRules = async (req, res) => {
    try {
        const rules = await fetchRules(req.user.id);
        res.json(rules);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch alert rules' });
    }
};

const putRule = async (req, res) => {
    try {
        const { id } = req.params;
        const { threshold, is_active } = req.body;
        const updated = await updateRule(id, req.user.id, threshold, is_active);

        if (!updated) {
            return res.status(404).json({ error: 'Alert rule not found' });
        }

        res.json(updated);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update alert rule' });
    }
};

module.exports = { getAlerts, getRules, putRule };