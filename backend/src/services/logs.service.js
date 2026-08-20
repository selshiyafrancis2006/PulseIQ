const pool = require("../config/db");

async function getLogs() {
  const result = await pool.query(`
    SELECT *
    FROM logs
    ORDER BY created_at DESC
  `);

  return result.rows;
}

module.exports = {
  getLogs,
};