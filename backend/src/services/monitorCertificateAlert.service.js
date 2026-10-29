const db = require('../config/db');
const { notifyUser } = require('./notification.service');

function getCertificateAlertLevel(daysRemaining) {
    if (daysRemaining == null || !Number.isFinite(Number(daysRemaining))) {
        return 0;
    }

    const days = Number(daysRemaining);

    if (days < 0) return 4;
    if (days <= 1) return 3;
    if (days <= 7) return 2;
    if (days <= 14) return 1;

    return 0;
}

function getCertificateAlertEvent(level) {
    const events = {
        1: {
            type: 'CERTIFICATE_EXPIRING',
            message: 'SSL certificate expires within 14 days'
        },
        2: {
            type: 'CERTIFICATE_EXPIRING',
            message: 'SSL certificate expires within 7 days'
        },
        3: {
            type: 'CERTIFICATE_EXPIRING',
            message: 'SSL certificate expires within 1 day'
        },
        4: {
            type: 'CERTIFICATE_EXPIRED',
            message: 'SSL certificate has expired'
        }
    };

    return events[level] ?? null;
}

async function processCertificateAlert(monitor, result) {
    if (!monitor.user_id || !result.certificateExpiresAt) return;

    const expiry = new Date(result.certificateExpiresAt);

    if (Number.isNaN(expiry.getTime())) return;

    const level = getCertificateAlertLevel(
        result.certificateDaysRemaining
    );

    // Always record a valid certificate expiry, even when it is outside
    // the warning window, so renewal resets the previous alert cycle.
    const stateResult = await db.query(
        `INSERT INTO monitor_certificate_alert_state
             (monitor_id, certificate_expires_at, last_alert_level)
         VALUES ($1, $2, 0)
         ON CONFLICT (monitor_id)
         DO UPDATE SET
             certificate_expires_at = EXCLUDED.certificate_expires_at,
             last_alert_level = CASE
                 WHEN monitor_certificate_alert_state.certificate_expires_at
                      IS DISTINCT FROM EXCLUDED.certificate_expires_at
                 THEN 0
                 ELSE monitor_certificate_alert_state.last_alert_level
             END,
             updated_at = NOW()
         RETURNING last_alert_level`,
        [monitor.id, expiry.toISOString()]
    );

    const lastLevel = Number(stateResult.rows[0]?.last_alert_level ?? 0);

    if (level === 0) return;

    if (level <= lastLevel) return;

    const alert = getCertificateAlertEvent(level);
    if (!alert) return;

    // Persist the attempted threshold before dispatch to prevent repeated
    // notifications on every check if a delivery channel fails.
    await db.query(
        `UPDATE monitor_certificate_alert_state
         SET last_alert_level = $2,
             updated_at = NOW()
         WHERE monitor_id = $1`,
        [monitor.id, level]
    );

    try {
        await notifyUser(monitor.user_id, {
            ...alert,
            monitor: {
                id: monitor.id,
                name: monitor.name,
                url: monitor.url
            },
            certificateExpiresAt: expiry.toISOString(),
            certificateDaysRemaining: Number(
                result.certificateDaysRemaining
            ),
            occurredAt: new Date().toISOString()
        });
    } catch (error) {
        console.error(
            `Certificate alert dispatch failed (monitor_id: ${monitor.id}):`,
            error
        );
    }
}

module.exports = {
    getCertificateAlertLevel,
    getCertificateAlertEvent,
    processCertificateAlert
};
