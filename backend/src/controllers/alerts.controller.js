const { fetchAlerts, fetchRules, updateRule } = require('../services/alert.service');

const getAlerts = async (req, res) => {
    try {
        const alerts = await fetchAlerts();
        res.json(alerts);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch alerts' });
    }
};

const getRules = async (req, res) => {
    try {
        const rules = await fetchRules();
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
        const updated = await updateRule(id, threshold, is_active);
        res.json(updated);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update alert rule' });
    }
};

module.exports = { getAlerts, getRules, putRule };