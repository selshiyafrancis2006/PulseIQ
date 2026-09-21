const pool = require("../config/db");

async function getLogs(userId) {
  const result = await pool.query(
    `
    SELECT *
    FROM logs
    WHERE user_id = $1
    ORDER BY created_at DESC
    `,
    [userId]
  );

  return result.rows;
}

module.exports = {
  getLogs,
};