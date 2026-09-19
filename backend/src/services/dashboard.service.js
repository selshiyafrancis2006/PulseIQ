const pool = require('../config/db');

const fetchDashboards = async (userId) => {

    const result = await pool.query(
        `SELECT id, name, created_at, updated_at
         FROM dashboards
         WHERE user_id = $1
         ORDER BY created_at ASC`,
        [userId]
    );

    return result.rows;
};

const fetchDashboardById = async (dashboardId, userId) => {

    const result = await pool.query(
        `SELECT id, name, layout, created_at, updated_at
         FROM dashboards
         WHERE id = $1 AND user_id = $2`,
        [dashboardId, userId]
    );

    return result.rows[0] || null;
};

const createDashboard = async (userId, name) => {

    const result = await pool.query(
        `INSERT INTO dashboards (user_id, name)
         VALUES ($1, $2)
         RETURNING id, name, layout, created_at, updated_at`,
        [userId, name]
    );

    return result.rows[0];
};

const renameDashboard = async (dashboardId, userId, name) => {

    const result = await pool.query(
        `UPDATE dashboards
         SET name = $1, updated_at = NOW()
         WHERE id = $2 AND user_id = $3
         RETURNING id, name, layout, created_at, updated_at`,
        [name, dashboardId, userId]
    );

    return result.rows[0] || null;
};

const updateLayout = async (dashboardId, userId, layout) => {

    const result = await pool.query(
        `UPDATE dashboards
         SET layout = $1, updated_at = NOW()
         WHERE id = $2 AND user_id = $3
         RETURNING id, name, layout, created_at, updated_at`,
        [JSON.stringify(layout), dashboardId, userId]
    );

    return result.rows[0] || null;
};

const deleteDashboard = async (dashboardId, userId) => {

    const result = await pool.query(
        `DELETE FROM dashboards
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [dashboardId, userId]
    );

    return result.rows.length > 0;
};

module.exports = {
    fetchDashboards,
    fetchDashboardById,
    createDashboard,
    renameDashboard,
    updateLayout,
    deleteDashboard
};