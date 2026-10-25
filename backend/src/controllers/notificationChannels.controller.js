const db = require('../config/db');
const { validatePublicHttpUrl } = require('../services/urlSecurity.service');
const { sendToChannel } = require('../services/notification.service');

const CHANNEL_TYPES = ['slack', 'webhook'];
const MAX_CHANNELS_PER_USER = 10;

function validateId(value) {
    return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) &&
        Number(value) > 0;
}

// Webhook URLs are secrets (anyone holding one can post to the channel),
// so the API never returns the full URL after creation.
function toPublic(row) {
    const url = row.url || '';
    let host = '';

    try {
        host = new URL(url).hostname;
    } catch {
        host = '';
    }

    return {
        id: row.id,
        type: row.type,
        name: row.name,
        is_active: row.is_active,
        created_at: row.created_at,
        url_hint: host ? `${host}/…${url.slice(-4)}` : null
    };
}

async function validateChannelUrl(type, value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 500) {
        return 'url must be a non-empty string of at most 500 characters';
    }

    let parsed;
    try {
        parsed = new URL(value.trim());
    } catch {
        return 'url must be a valid URL';
    }

    if (type === 'slack' &&
        (parsed.protocol !== 'https:' || parsed.hostname !== 'hooks.slack.com')) {
        return 'Slack URL must be an https://hooks.slack.com/... incoming webhook';
    }

    try {
        await validatePublicHttpUrl(parsed.href);
    } catch (error) {
        return error.message;
    }

    return null;
}

const listChannels = async (req, res) => {
    try {
        const result = await db.query(
            `SELECT * FROM notification_channels
             WHERE user_id = $1 ORDER BY id`,
            [req.user.id]
        );
        res.json(result.rows.map(toPublic));
    } catch (error) {
        console.error('List channels failed:', error);
        res.status(500).json({ message: 'Failed to fetch channels' });
    }
};

const createChannel = async (req, res) => {
    try {
        const { type, name, url } = req.body || {};

        if (!CHANNEL_TYPES.includes(type)) {
            return res.status(400).json({
                message: `type must be one of: ${CHANNEL_TYPES.join(', ')}`
            });
        }

        if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
            return res.status(400).json({
                message: 'name must be a non-empty string of at most 100 characters'
            });
        }

        const urlError = await validateChannelUrl(type, url);
        if (urlError) return res.status(400).json({ message: urlError });

        const count = await db.query(
            'SELECT COUNT(*)::int AS n FROM notification_channels WHERE user_id = $1',
            [req.user.id]
        );
        if (count.rows[0].n >= MAX_CHANNELS_PER_USER) {
            return res.status(400).json({
                message: `You can have at most ${MAX_CHANNELS_PER_USER} channels`
            });
        }

        const result = await db.query(
            `INSERT INTO notification_channels (user_id, type, name, url)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [req.user.id, type, name.trim(), url.trim()]
        );

        res.status(201).json(toPublic(result.rows[0]));
    } catch (error) {
        console.error('Create channel failed:', error);
        res.status(500).json({ message: 'Failed to create channel' });
    }
};

const updateChannel = async (req, res) => {
    const { id } = req.params;
    if (!validateId(id)) return res.status(400).json({ message: 'Invalid channel ID' });

    try {
        const body = req.body || {};
        const allowed = ['name', 'is_active'];
        const keys = Object.keys(body);

        if (!keys.length || keys.some((key) => !allowed.includes(key))) {
            return res.status(400).json({
                message: 'Provide supported fields: name, is_active'
            });
        }

        const current = await db.query(
            'SELECT * FROM notification_channels WHERE id = $1 AND user_id = $2',
            [Number(id), req.user.id]
        );
        if (!current.rows.length) {
            return res.status(404).json({ message: 'Channel not found' });
        }

        const name = Object.hasOwn(body, 'name') ? body.name : current.rows[0].name;
        const isActive = Object.hasOwn(body, 'is_active')
            ? body.is_active : current.rows[0].is_active;

        if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
            return res.status(400).json({
                message: 'name must be a non-empty string of at most 100 characters'
            });
        }
        if (typeof isActive !== 'boolean') {
            return res.status(400).json({ message: 'is_active must be a boolean' });
        }

        const result = await db.query(
            `UPDATE notification_channels
             SET name = $1, is_active = $2
             WHERE id = $3 AND user_id = $4 RETURNING *`,
            [name.trim(), isActive, Number(id), req.user.id]
        );

        res.json(toPublic(result.rows[0]));
    } catch (error) {
        console.error('Update channel failed:', error);
        res.status(500).json({ message: 'Failed to update channel' });
    }
};

const deleteChannel = async (req, res) => {
    const { id } = req.params;
    if (!validateId(id)) return res.status(400).json({ message: 'Invalid channel ID' });

    try {
        const result = await db.query(
            'DELETE FROM notification_channels WHERE id = $1 AND user_id = $2 RETURNING id',
            [Number(id), req.user.id]
        );
        if (!result.rows.length) {
            return res.status(404).json({ message: 'Channel not found' });
        }
        res.json({ message: 'Channel deleted' });
    } catch (error) {
        console.error('Delete channel failed:', error);
        res.status(500).json({ message: 'Failed to delete channel' });
    }
};

const testChannel = async (req, res) => {
    const { id } = req.params;
    if (!validateId(id)) return res.status(400).json({ message: 'Invalid channel ID' });

    try {
        const result = await db.query(
            'SELECT * FROM notification_channels WHERE id = $1 AND user_id = $2',
            [Number(id), req.user.id]
        );
        if (!result.rows.length) {
            return res.status(404).json({ message: 'Channel not found' });
        }

        try {
            await sendToChannel(result.rows[0], {
                type: 'TEST',
                monitor: { id: 0, name: 'Test monitor', url: 'https://example.com' },
                message: 'This is a test notification from PulseIQ',
                occurredAt: new Date().toISOString()
            });
            res.json({ ok: true });
        } catch (error) {
            res.status(502).json({ ok: false, message: error.message });
        }
    } catch (error) {
        console.error('Test channel failed:', error);
        res.status(500).json({ message: 'Failed to test channel' });
    }
};

module.exports = {
    listChannels,
    createChannel,
    updateChannel,
    deleteChannel,
    testChannel
};