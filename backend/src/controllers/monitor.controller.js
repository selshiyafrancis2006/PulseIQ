const db = require('../config/db');

// Same normalization used for host tags: trims, drops empties, de-dupes.
function normalizeTags(rawTags) {

    if (!rawTags) {
        return [];
    }

    const list = Array.isArray(rawTags)
        ? rawTags
        : String(rawTags).split(',');

    const cleaned = list
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);

    return [...new Set(cleaned)];
}

const createMonitor = async (req, res) => {
    try {
        const { name, url, tags } = req.body;

        const normalizedTags = normalizeTags(tags);

        const result = await db.query(
            `INSERT INTO monitors (name, url, user_id, tags)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [name, url, req.user.id, normalizedTags]
        );

        res.status(201).json(result.rows[0]);

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Failed to create monitor'
        });
    }
};

const getMonitors = async (req, res) => {
    try {

        const result = await db.query(
            'SELECT * FROM monitors WHERE user_id = $1 ORDER BY id DESC',
            [req.user.id]
        );

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: 'Failed to fetch monitors'
        });

    }
};

const getMonitorStatus = async (req, res) => {
    try {

        const { tag } = req.query;

        const result = await db.query(`
            SELECT DISTINCT ON (m.id)
                m.id,
                m.name,
                m.url,
                m.tags,
                mr.status,
                mr.response_time_ms,
                mr.status_code,
                mr.checked_at
            FROM monitors m
            LEFT JOIN monitor_results mr
                ON m.id = mr.monitor_id
            WHERE m.user_id = $1
              AND ($2::text IS NULL OR m.tags @> ARRAY[$2::text])
            ORDER BY m.id, mr.checked_at DESC
        `, [req.user.id, tag || null]);

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: 'Failed to fetch monitor status'
        });

    }
};

const getMonitorHistory = async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(
            `SELECT
                mr.status,
                mr.response_time_ms,
                mr.status_code,
                mr.checked_at
             FROM monitor_results mr
             JOIN monitors m ON mr.monitor_id = m.id
             WHERE mr.monitor_id = $1
               AND m.user_id = $2
             ORDER BY mr.checked_at DESC
             LIMIT 50`,
            [id, req.user.id]
        );

        res.json(result.rows);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: 'Failed to fetch monitor history'
        });
    }
};

const getMonitorUptime = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `
      SELECT mr.status
      FROM monitor_results mr
      JOIN monitors m ON mr.monitor_id = m.id
      WHERE mr.monitor_id = $1
        AND m.user_id = $2
      ORDER BY mr.checked_at DESC
      LIMIT 100
      `,
      [id, req.user.id]
    );

    const rows = result.rows;

    if (!rows.length) {
      return res.json({ uptime: 100 });
    }

    const upCount = rows.filter(r => r.status === 'UP').length;
    const uptime = ((upCount / rows.length) * 100).toFixed(2);

    res.json({ uptime });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to calculate uptime' });
  }
};

const getMonitorEvents = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `
      SELECT
        me.id,
        me.type,
        me.message,
        me.response_time_ms,
        me.created_at
      FROM monitor_events me
      JOIN monitors m ON me.monitor_id = m.id
      WHERE me.monitor_id = $1
        AND m.user_id = $2
      ORDER BY me.created_at DESC
      LIMIT 100
      `,
      [id, req.user.id]
    );

    res.json(result.rows);

  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: 'Failed to fetch monitor events'
    });
  }
};

module.exports = {
    createMonitor,
    getMonitors,
    getMonitorStatus,
    getMonitorHistory,
    getMonitorUptime,
    getMonitorEvents
};