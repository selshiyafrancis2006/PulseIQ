const { fetchAlerts, fetchRules, updateRule, acknowledgeAlert } = require('../services/alert.service');

const getAlerts = async (req, res) => {
    try {
        const { host_id, limit: rawLimit, offset: rawOffset } = req.query;

        if (
            host_id !== undefined &&
            (
                !/^[1-9]\d*$/.test(String(host_id)) ||
                !Number.isSafeInteger(Number(host_id))
            )
        ) {
            return res.status(400).json({ error: 'A valid host_id is required' });
        }

        const limit = rawLimit === undefined ? 20 : Number(rawLimit);
        const offset = rawOffset === undefined ? 0 : Number(rawOffset);

        if (
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 100 ||
            !Number.isInteger(offset) ||
            offset < 0
        ) {
            return res.status(400).json({
                error: 'limit must be an integer from 1 to 100 and offset must be a non-negative integer'
            });
        }

        const alerts = await fetchAlerts(
            host_id === undefined ? null : Number(host_id),
            req.user.id,
            limit,
            offset
        );

        res.json(alerts);
    } catch (err) {
        console.error('Failed to fetch alerts:', err);
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


const postAcknowledgeAlert = async (req, res) => {
    try {
        const { id } = req.params;

        if (!/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id))) {
            return res.status(400).json({ error: 'A valid alert id is required' });
        }

        const alert = await acknowledgeAlert(Number(id), req.user.id);

        if (!alert) {
            return res.status(404).json({ error: 'Alert not found' });
        }

        res.json({
            message: 'Alert acknowledged',
            ...alert
        });
    } catch (err) {
        console.error('Failed to acknowledge alert:', err);
        res.status(500).json({ error: 'Failed to acknowledge alert' });
    }
};
module.exports = { getAlerts, getRules, putRule, postAcknowledgeAlert };