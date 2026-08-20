const db = require('../config/db');
const axios = require('axios');

const checkMonitor = async (monitor) => {

  const start = Date.now();

  try {
    const response = await axios.get(monitor.url);
    const responseTime = Date.now() - start;

    // Get previous status BEFORE inserting new result
    const prev = await db.query(
      `SELECT status
       FROM monitor_results
       WHERE monitor_id = $1
       ORDER BY checked_at DESC
       LIMIT 1`,
      [monitor.id]
    );

    const previousStatus = prev.rows[0]?.status;

    // Insert result FIRST
    await db.query(
      `INSERT INTO monitor_results
       (monitor_id, status, response_time_ms, status_code)
       VALUES ($1, $2, $3, $4)`,
      [
        monitor.id,
        'UP',
        responseTime,
        response.status
      ]
    );

    // Recovery event (DOWN → UP)
    if (previousStatus === 'DOWN') {
      await db.query(
        `INSERT INTO monitor_events
         (monitor_id, type, message, response_time_ms)
         VALUES ($1, $2, $3, $4)`,
        [
          monitor.id,
          'UP',
          'Service recovered',
          responseTime
        ]
      );
    }

    return {
      status: 'UP',
      responseTime,
      statusCode: response.status
    };

  } catch (error) {

    const responseTime = null;

    // Get previous status BEFORE inserting DOWN
    const prev = await db.query(
      `SELECT status
       FROM monitor_results
       WHERE monitor_id = $1
       ORDER BY checked_at DESC
       LIMIT 1`,
      [monitor.id]
    );

    const previousStatus = prev.rows[0]?.status;

    await db.query(
      `INSERT INTO monitor_results
       (monitor_id, status)
       VALUES ($1, $2)`,
      [
        monitor.id,
        'DOWN'
      ]
    );

    // DOWN event only when state changes
    if (previousStatus !== 'DOWN') {
      await db.query(
        `INSERT INTO monitor_events
         (monitor_id, type, message)
         VALUES ($1, $2, $3)`,
        [
          monitor.id,
          'DOWN',
          'Service is down'
        ]
      );
    }

    return {
      status: 'DOWN',
      responseTime: null,
      statusCode: null
    };
  }
};

module.exports = {
  checkMonitor
};