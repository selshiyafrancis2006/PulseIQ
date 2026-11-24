const {
    fetchAlerts,
    fetchRules,
    createRule,
    updateRule,
    deleteRule,
    acknowledgeAlert
} = require('../services/alert.service');

const VALID_METRICS = new Set([
    'cpu_usage',
    'memory_usage',
    'disk_usage',
    'network_in',
    'network_out'
]);

const VALID_OPERATORS = new Set(['>', '<', '>=', '<=']);
const PERCENTAGE_METRICS = new Set([
    'cpu_usage',
    'memory_usage',
    'disk_usage'
]);

const RULE_FIELDS = new Set([
    'metric_name',
    'operator',
    'threshold',
    'duration',
    'is_active',
    'host_id'
]);

function validateRuleFields(body, { creating = false } = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return 'A valid rule object is required';
    }

    const keys = Object.keys(body);

    if (keys.some(key => !RULE_FIELDS.has(key))) {
        return 'Unsupported alert rule field';
    }

    if (creating && ['metric_name', 'operator', 'threshold'].some(
        key => !Object.prototype.hasOwnProperty.call(body, key)
    )) {
        return 'metric_name, operator, and threshold are required';
    }

    if (
        Object.prototype.hasOwnProperty.call(body, 'metric_name') &&
        !VALID_METRICS.has(body.metric_name)
    ) {
        return 'Unsupported metric_name';
    }

    if (
        Object.prototype.hasOwnProperty.call(body, 'operator') &&
        !VALID_OPERATORS.has(body.operator)
    ) {
        return 'Unsupported operator';
    }

    if (Object.prototype.hasOwnProperty.call(body, 'threshold')) {
        const threshold = body.threshold;

        if (typeof threshold !== 'number' || !Number.isFinite(threshold)) {
            return 'threshold must be a finite number';
        }

        const metricName = body.metric_name;

        if (threshold < 0) {
            return 'threshold must be non-negative';
        }

        if (
            metricName &&
            PERCENTAGE_METRICS.has(metricName) &&
            threshold > 100
        ) {
            return 'Percentage metric thresholds must not exceed 100';
        }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'duration')) {
        if (
            !Number.isInteger(body.duration) ||
            body.duration < 1 ||
            body.duration > 3600
        ) {
            return 'duration must be an integer from 1 to 3600';
        }
    }

    if (
        Object.prototype.hasOwnProperty.call(body, 'is_active') &&
        typeof body.is_active !== 'boolean'
    ) {
        return 'is_active must be a boolean';
    }

    if (Object.prototype.hasOwnProperty.call(body, 'host_id')) {
        const hostId = body.host_id;

        if (
            hostId !== null &&
            (
                !Number.isSafeInteger(hostId) ||
                hostId < 1
            )
        ) {
            return 'host_id must be a positive integer or null';
        }
    }

    return null;
}

function validRuleId(id) {
    return /^[1-9]\d*$/.test(String(id)) &&
        Number.isSafeInteger(Number(id));
}

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

const postRule = async (req, res) => {
    try {
        const validationError = validateRuleFields(req.body, { creating: true });

        if (validationError) {
            return res.status(400).json({ error: validationError });
        }

        const rule = {
            metric_name: req.body.metric_name,
            operator: req.body.operator,
            threshold: req.body.threshold,
            duration: req.body.duration ?? 1,
            is_active: req.body.is_active ?? true,
            host_id: req.body.host_id ?? null
        };

        const created = await createRule(req.user.id, rule);

        if (!created) {
            return res.status(404).json({
                error: 'Host not found or not owned by this user'
            });
        }

        return res.status(201).json(created);
    } catch (err) {
        console.error('Failed to create alert rule:', err);
        return res.status(500).json({ error: 'Failed to create alert rule' });
    }
};

const putRule = async (req, res) => {
    try {
        if (!validRuleId(req.params.id)) {
            return res.status(400).json({ error: 'A valid alert rule id is required' });
        }

        const validationError = validateRuleFields(req.body);

        if (validationError) {
            return res.status(400).json({ error: validationError });
        }

        if (Object.keys(req.body).length === 0) {
            return res.status(400).json({ error: 'At least one rule field is required' });
        }

        const existingRules = await fetchRules(req.user.id);
        const existingRule = existingRules.find(
            rule => Number(rule.id) === Number(req.params.id)
        );

        if (!existingRule) {
            return res.status(404).json({
                error: 'Alert rule not found or host not owned by this user'
            });
        }

        const mergedRule = Object.fromEntries(
            [...RULE_FIELDS].map(field => [
                field,
                Object.prototype.hasOwnProperty.call(req.body, field)
                    ? req.body[field]
                    : existingRule[field]
            ])
        );

        mergedRule.threshold = Number(mergedRule.threshold);

        const mergedValidationError = validateRuleFields(mergedRule);

        if (mergedValidationError) {
            return res.status(400).json({ error: mergedValidationError });
        }

        const updated = await updateRule(
            Number(req.params.id),
            req.user.id,
            req.body
        );

        if (!updated) {
            return res.status(404).json({
                error: 'Alert rule not found or host not owned by this user'
            });
        }

        return res.json(updated);
    } catch (err) {
        console.error('Failed to update alert rule:', err);
        return res.status(500).json({ error: 'Failed to update alert rule' });
    }
};

const deleteRuleController = async (req, res) => {
    try {
        if (!validRuleId(req.params.id)) {
            return res.status(400).json({ error: 'A valid alert rule id is required' });
        }

        const deleted = await deleteRule(Number(req.params.id), req.user.id);

        if (!deleted) {
            return res.status(404).json({ error: 'Alert rule not found' });
        }

        return res.json({
            message: 'Alert rule deleted',
            id: deleted.id
        });
    } catch (err) {
        console.error('Failed to delete alert rule:', err);
        return res.status(500).json({ error: 'Failed to delete alert rule' });
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
module.exports = { getAlerts, getRules, postRule, putRule, deleteRuleController, postAcknowledgeAlert };