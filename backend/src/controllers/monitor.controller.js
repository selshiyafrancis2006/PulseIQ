const db = require('../config/db');

const createMonitor = async (req, res) => {
    try {
        const { name, url } = req.body;

        const result = await db.query(
            `INSERT INTO monitors (name, url)
             VALUES ($1, $2)
             RETURNING *`,
            [name, url]
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
            'SELECT * FROM monitors ORDER BY id DESC'
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

        const result = await db.query(`
            SELECT DISTINCT ON (m.id)
                m.id,
                m.name,
                m.url,
                mr.status,
                mr.response_time_ms,
                mr.status_code,
                mr.checked_at
            FROM monitors m
            LEFT JOIN monitor_results mr
                ON m.id = mr.monitor_id
            ORDER BY m.id, mr.checked_at DESC
        `);

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
                status,
                response_time_ms,
                status_code,
                checked_at
             FROM monitor_results
             WHERE monitor_id = $1
             ORDER BY checked_at DESC
             LIMIT 50`,
            [id]
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
      SELECT status
      FROM monitor_results
      WHERE monitor_id = $1
      ORDER BY checked_at DESC
      LIMIT 100
      `,
      [id]
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
        id,
        type,
        message,
        response_time_ms,
        created_at
      FROM monitor_events
      WHERE monitor_id = $1
      ORDER BY created_at DESC
      LIMIT 100
      `,
      [id]
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