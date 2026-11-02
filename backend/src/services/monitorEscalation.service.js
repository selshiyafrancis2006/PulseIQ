const db = require('../config/db');
const { notifyUser } = require('./notification.service');

function dispatchEscalation(monitor, stage, downForSeconds, result) {
    const channelIds = stage.routing_mode === 'SELECTED'
        ? stage.channel_ids
        : null;

    void notifyUser(
        monitor.user_id,
        {
            type: 'ESCALATION',
            escalationStage: stage.stage_number,
            downForSeconds,
            responseTimeMs: result.responseTime ?? null,
            statusCode: result.statusCode ?? null,
            errorType: result.errorType ?? null,
            errorMessage: result.errorMessage ?? null,
            message: `Service remains down after ${stage.delay_minutes} minutes`,
            monitor: {
                id: monitor.id,
                name: monitor.name,
                url: monitor.url
            },
            occurredAt: new Date().toISOString()
        },
        channelIds,
        true
    ).catch((error) => {
        console.error(
            `Escalation dispatch failed (monitor_id: ${monitor.id}, stage: ${stage.stage_number}):`,
            error
        );
    });
}

async function processEscalation(monitor, result, isFlapping) {
    if (!monitor.user_id) return;

    // Recovery ends the outage and resets the complete escalation clock.
    if (result.status !== 'DOWN') {
        await db.query(
            `UPDATE monitor_alert_state
             SET outage_started_at = NULL,
                 escalation_stage = 0,
                 escalation_paused_at = NULL,
                 escalation_paused_seconds = 0,
                 updated_at = NOW()
             WHERE monitor_id = $1`,
            [monitor.id]
        );
        return;
    }

    // Start the outage clock if this is the first observed DOWN check.
    await db.query(
        `UPDATE monitor_alert_state
         SET outage_started_at = COALESCE(outage_started_at, NOW()),
             escalation_stage = CASE
                 WHEN outage_started_at IS NULL THEN 0
                 ELSE escalation_stage
             END,
             updated_at = NOW()
         WHERE monitor_id = $1`,
        [monitor.id]
    );

    if (isFlapping) {
        // Pause once. Repeated flapping checks must not reset the pause time.
        await db.query(
            `UPDATE monitor_alert_state
             SET escalation_paused_at = COALESCE(escalation_paused_at, NOW()),
                 updated_at = NOW()
             WHERE monitor_id = $1`,
            [monitor.id]
        );
        return;
    }

    // Resume the clock by adding the paused duration to the accumulated total.
    await db.query(
        `UPDATE monitor_alert_state
         SET escalation_paused_seconds = escalation_paused_seconds +
                 CASE
                     WHEN escalation_paused_at IS NULL THEN 0
                     ELSE GREATEST(
                         0,
                         FLOOR(EXTRACT(EPOCH FROM (NOW() - escalation_paused_at)))
                     )::int
                 END,
             escalation_paused_at = NULL,
             updated_at = NOW()
         WHERE monitor_id = $1
           AND escalation_paused_at IS NOT NULL`,
        [monitor.id]
    );

    const elapsedResult = await db.query(
        `SELECT GREATEST(
                    0,
                    FLOOR(
                        EXTRACT(EPOCH FROM (NOW() - outage_started_at))
                        - escalation_paused_seconds
                    )
                )::int AS active_outage_seconds,
                escalation_stage
         FROM monitor_alert_state
         WHERE monitor_id = $1`,
        [monitor.id]
    );

    const state = elapsedResult.rows[0];
    if (!state || state.active_outage_seconds == null) return;

    const stagesResult = await db.query(
        `SELECT
             stages.stage_number,
             stages.delay_minutes,
             stages.routing_mode,
             COALESCE(
                 ARRAY_AGG(stage_channels.channel_id)
                     FILTER (WHERE stage_channels.channel_id IS NOT NULL),
                 ARRAY[]::INTEGER[]
             ) AS channel_ids
         FROM monitor_escalation_stages stages
         LEFT JOIN monitor_escalation_stage_channels stage_channels
             ON stage_channels.stage_id = stages.id
         WHERE stages.monitor_id = $1
         GROUP BY stages.id
         ORDER BY stages.stage_number`,
        [monitor.id]
    );

    const dueStages = stagesResult.rows.filter((stage) =>
        stage.stage_number > state.escalation_stage &&
        stage.delay_minutes * 60 <= state.active_outage_seconds
    );

    for (const stage of dueStages) {
        // Advance persisted progress before dispatching the notification.
        const advanced = await db.query(
            `UPDATE monitor_alert_state
             SET escalation_stage = $2,
                 updated_at = NOW()
             WHERE monitor_id = $1
               AND escalation_stage < $2
               AND escalation_paused_at IS NULL
             RETURNING escalation_stage`,
            [monitor.id, stage.stage_number]
        );

        if (!advanced.rows.length) continue;

        dispatchEscalation(
            monitor,
            stage,
            state.active_outage_seconds,
            result
        );
    }
}

module.exports = { processEscalation };
