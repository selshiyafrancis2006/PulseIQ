const db = require('../config/db');

function parseMonitorId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const getMonitorNotificationChannels = async (req, res) => {
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

        const [settings, channels] = await Promise.all([
            db.query(
                `SELECT routing_mode
                 FROM monitor_notification_settings
                 WHERE monitor_id = $1`,
                [monitorId]
            ),
            db.query(
                `SELECT
                    channel.id,
                    channel.type,
                    channel.name,
                    channel.is_active,
                    (selected.channel_id IS NOT NULL) AS is_selected
                 FROM notification_channels channel
                 LEFT JOIN monitor_notification_channels selected
                   ON selected.channel_id = channel.id
                  AND selected.monitor_id = $2
                 WHERE channel.user_id = $1
                 ORDER BY channel.id`,
                [req.user.id, monitorId]
            )
        ]);

        const routingMode = settings.rows[0]?.routing_mode || 'ALL';

        return res.json({
            monitor_id: monitorId,
            routing_mode: routingMode,
            channel_ids: channels.rows
                .filter(channel => channel.is_selected)
                .map(channel => channel.id),
            channels: channels.rows
        });
    } catch (error) {
        console.error('Get monitor notification routing failed:', error);
        return res.status(500).json({
            message: 'Failed to fetch monitor notification routing'
        });
    }
};

const updateMonitorNotificationChannels = async (req, res) => {
    const monitorId = parseMonitorId(req.params.id);

    if (!monitorId) {
        return res.status(400).json({ message: 'Invalid monitor ID' });
    }

    const body = req.body || {};
    const { routing_mode: routingMode } = body;
    const channelIds = body.channel_ids === undefined ? [] : body.channel_ids;

    if (Object.keys(body).some(key => !['routing_mode', 'channel_ids'].includes(key))) {
        return res.status(400).json({
            message: 'Only routing_mode and channel_ids are supported'
        });
    }

    if (!['ALL', 'SELECTED'].includes(routingMode)) {
        return res.status(400).json({
            message: 'routing_mode must be ALL or SELECTED'
        });
    }

    if (!Array.isArray(channelIds)) {
        return res.status(400).json({
            message: 'channel_ids must be an array'
        });
    }

    if (
        channelIds.length > 10 ||
        channelIds.some(id => !Number.isSafeInteger(id) || id <= 0)
    ) {
        return res.status(400).json({
            message: 'channel_ids must contain at most 10 positive integer IDs'
        });
    }

    if (new Set(channelIds).size !== channelIds.length) {
        return res.status(400).json({
            message: 'channel_ids must not contain duplicates'
        });
    }

    if (routingMode === 'ALL' && channelIds.length > 0) {
        return res.status(400).json({
            message: 'channel_ids must be empty when routing_mode is ALL'
        });
    }

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
            `INSERT INTO monitor_notification_settings
                (monitor_id, routing_mode, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (monitor_id)
             DO UPDATE SET
                routing_mode = EXCLUDED.routing_mode,
                updated_at = NOW()`,
            [monitorId, routingMode]
        );

        await client.query(
            'DELETE FROM monitor_notification_channels WHERE monitor_id = $1',
            [monitorId]
        );

        if (channelIds.length > 0) {
            await client.query(
                `INSERT INTO monitor_notification_channels (monitor_id, channel_id)
                 SELECT $1, selected.channel_id
                 FROM unnest($2::int[]) AS selected(channel_id)`,
                [monitorId, channelIds]
            );
        }

        await client.query('COMMIT');
        transactionStarted = false;

        return res.json({
            monitor_id: monitorId,
            routing_mode: routingMode,
            channel_ids: channelIds
        });
    } catch (error) {
        if (transactionStarted) {
            await client.query('ROLLBACK').catch(() => {});
        }

        console.error('Update monitor notification routing failed:', error);
        return res.status(500).json({
            message: 'Failed to update monitor notification routing'
        });
    } finally {
        client.release();
    }
};

module.exports = {
    getMonitorNotificationChannels,
    updateMonitorNotificationChannels
};

