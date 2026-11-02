const db = require('../config/db');

function parseMonitorId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function validateStages(stages) {
    if (!Array.isArray(stages) || stages.length > 5) {
        return 'stages must be an array containing at most 5 stages';
    }

    let previousDelay = 0;

    for (let index = 0; index < stages.length; index += 1) {
        const stage = stages[index];

        if (!stage || typeof stage !== 'object' || Array.isArray(stage)) {
            return `Stage ${index + 1} must be an object`;
        }

        if (Object.keys(stage).some(key =>
            !['stage_number', 'delay_minutes', 'routing_mode', 'channel_ids'].includes(key)
        )) {
            return `Stage ${index + 1} contains unsupported fields`;
        }

        if (stage.stage_number !== index + 1) {
            return 'Stage numbers must be sequential, starting at 1';
        }

        if (
            !Number.isSafeInteger(stage.delay_minutes) ||
            stage.delay_minutes < 1 ||
            stage.delay_minutes > 10080 ||
            stage.delay_minutes <= previousDelay
        ) {
            return 'Stage delays must be strictly increasing integers between 1 and 10080 minutes';
        }

        if (!['ALL', 'SELECTED'].includes(stage.routing_mode)) {
            return `Stage ${index + 1} routing_mode must be ALL or SELECTED`;
        }

        if (!Array.isArray(stage.channel_ids)) {
            return `Stage ${index + 1} channel_ids must be an array`;
        }

        if (
            stage.channel_ids.length > 10 ||
            stage.channel_ids.some(id => !Number.isSafeInteger(id) || id <= 0)
        ) {
            return `Stage ${index + 1} channel_ids must contain at most 10 positive integer IDs`;
        }

        if (new Set(stage.channel_ids).size !== stage.channel_ids.length) {
            return `Stage ${index + 1} channel_ids must not contain duplicates`;
        }

        if (stage.routing_mode === 'ALL' && stage.channel_ids.length > 0) {
            return `Stage ${index + 1} channel_ids must be empty when routing_mode is ALL`;
        }

        if (stage.routing_mode === 'SELECTED' && stage.channel_ids.length === 0) {
            return `Stage ${index + 1} must select at least one notification channel`;
        }

        previousDelay = stage.delay_minutes;
    }

    return null;
}

const getMonitorEscalation = async (req, res) => {
    const monitorId = parseMonitorId(req.params.id);

    if (!monitorId) {
        return res.status(400).json({ message: 'Invalid monitor ID' });
    }

    try {
        const monitor = await db.query(
            'SELECT id FROM monitors WHERE id = $1 AND user_id = $2',
            [monitorId, req.user.id]
        );

        if (!monitor.rows.length) {
            return res.status(404).json({ message: 'Monitor not found' });
        }

        const [stagesResult, channelsResult] = await Promise.all([
            db.query(
                `SELECT
                    stage.id,
                    stage.stage_number,
                    stage.delay_minutes,
                    stage.routing_mode,
                    COALESCE(
                        ARRAY_AGG(selected.channel_id)
                            FILTER (WHERE selected.channel_id IS NOT NULL),
                        ARRAY[]::INTEGER[]
                    ) AS channel_ids
                 FROM monitor_escalation_stages stage
                 LEFT JOIN monitor_escalation_stage_channels selected
                   ON selected.stage_id = stage.id
                 WHERE stage.monitor_id = $1
                 GROUP BY stage.id
                 ORDER BY stage.stage_number`,
                [monitorId]
            ),
            db.query(
                `SELECT id, type, name, is_active
                 FROM notification_channels
                 WHERE user_id = $1
                 ORDER BY id`,
                [req.user.id]
            )
        ]);

        return res.json({
            monitor_id: monitorId,
            stages: stagesResult.rows,
            channels: channelsResult.rows
        });
    } catch (error) {
        console.error('Get monitor escalation policy failed:', error);
        return res.status(500).json({
            message: 'Failed to fetch monitor escalation policy'
        });
    }
};

const updateMonitorEscalation = async (req, res) => {
    const monitorId = parseMonitorId(req.params.id);

    if (!monitorId) {
        return res.status(400).json({ message: 'Invalid monitor ID' });
    }

    const body = req.body || {};

    if (Object.keys(body).some(key => key !== 'stages')) {
        return res.status(400).json({
            message: 'Only stages is supported'
        });
    }

    const stages = body.stages;
    const validationError = validateStages(stages);

    if (validationError) {
        return res.status(400).json({ message: validationError });
    }

    const channelIds = [...new Set(stages.flatMap(stage => stage.channel_ids))];
    const client = await db.connect();
    let transactionStarted = false;

    try {
        await client.query('BEGIN');
        transactionStarted = true;

        const monitor = await client.query(
            `SELECT id
             FROM monitors
             WHERE id = $1 AND user_id = $2
             FOR UPDATE`,
            [monitorId, req.user.id]
        );

        if (!monitor.rows.length) {
            await client.query('ROLLBACK');
            transactionStarted = false;
            return res.status(404).json({ message: 'Monitor not found' });
        }

        if (channelIds.length > 0) {
            const ownedChannels = await client.query(
                `SELECT id
                 FROM notification_channels
                 WHERE user_id = $1
                   AND id = ANY($2::int[])`,
                [req.user.id, channelIds]
            );

            if (ownedChannels.rows.length !== channelIds.length) {
                await client.query('ROLLBACK');
                transactionStarted = false;
                return res.status(400).json({
                    message: 'Every selected channel must belong to your account'
                });
            }
        }

        await client.query(
            'DELETE FROM monitor_escalation_stages WHERE monitor_id = $1',
            [monitorId]
        );

        for (const stage of stages) {
            const inserted = await client.query(
                `INSERT INTO monitor_escalation_stages
                    (monitor_id, stage_number, delay_minutes, routing_mode)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id`,
                [
                    monitorId,
                    stage.stage_number,
                    stage.delay_minutes,
                    stage.routing_mode
                ]
            );

            if (stage.channel_ids.length > 0) {
                await client.query(
                    `INSERT INTO monitor_escalation_stage_channels
                        (stage_id, channel_id)
                     SELECT $1, selected.channel_id
                     FROM unnest($2::int[]) AS selected(channel_id)`,
                    [inserted.rows[0].id, stage.channel_ids]
                );
            }
        }

        await client.query('COMMIT');
        transactionStarted = false;

        return res.json({
            monitor_id: monitorId,
            stages
        });
    } catch (error) {
        if (transactionStarted) {
            await client.query('ROLLBACK').catch(() => {});
        }

        console.error('Update monitor escalation policy failed:', error);
        return res.status(500).json({
            message: 'Failed to update monitor escalation policy'
        });
    } finally {
        client.release();
    }
};

module.exports = {
    getMonitorEscalation,
    updateMonitorEscalation
};
