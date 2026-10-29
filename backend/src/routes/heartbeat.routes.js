const express = require('express');
const crypto = require('crypto');
const db = require('../config/db');

const router = express.Router();

router.post('/:monitorId', async (req, res) => {
    const { monitorId } = req.params;
    const token = req.get('x-heartbeat-token');

    if (!/^\d+$/.test(monitorId) ||
        !Number.isSafeInteger(Number(monitorId)) ||
        Number(monitorId) <= 0) {
        return res.status(400).json({ message: 'Invalid monitor ID' });
    }

    if (typeof token !== 'string' || token.length !== 64) {
        return res.status(401).json({ message: 'Invalid heartbeat token' });
    }

    const suppliedHash = crypto
        .createHash('sha256')
        .update(token)
        .digest();

    try {
        const result = await db.query(
            `SELECT s.token_hash
             FROM heartbeat_monitor_secrets s
             JOIN monitors m ON m.id = s.monitor_id
             WHERE m.id = $1
               AND m.monitor_type = 'HEARTBEAT'
               AND m.is_active = TRUE`,
            [Number(monitorId)]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                message: 'Active heartbeat monitor not found'
            });
        }

        const storedHash = Buffer.from(
            result.rows[0].token_hash.trim(),
            'hex'
        );

        if (
            storedHash.length !== suppliedHash.length ||
            !crypto.timingSafeEqual(storedHash, suppliedHash)
        ) {
            return res.status(401).json({
                message: 'Invalid heartbeat token'
            });
        }

        await db.query(
            `UPDATE heartbeat_monitor_secrets
             SET last_seen_at = NOW()
             WHERE monitor_id = $1`,
            [Number(monitorId)]
        );

        return res.status(202).json({
            message: 'Heartbeat received',
            monitor_id: Number(monitorId)
        });
    } catch (error) {
        console.error('Heartbeat check-in failed:', error);
        return res.status(500).json({
            message: 'Failed to process heartbeat'
        });
    }
});

module.exports = router;
