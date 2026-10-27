const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');
const {
    rollupRecentMonitorResults,
    cleanupMonitorResults
} = require('../src/services/monitorRollup.service');

let monitorId;

beforeAll(async () => {
    await resetDb();
    const { token } = await createUser();
    const res = await request(app)
        .post('/api/monitors')
        .set(authHeader(token))
        .send({ name: 'rollup-test', url: 'https://example.com' });
    expect(res.status).toBe(201);
    monitorId = res.body.id;
});

afterAll(async () => {
    await pool.end();
});

async function insert(status, ms, minutesAgo, inMaintenance = false) {
    await pool.query(
        `INSERT INTO monitor_results
            (monitor_id, status, response_time_ms, checked_at, in_maintenance)
         VALUES ($1, $2, $3, NOW() - ($4 * INTERVAL '1 minute'), $5)`,
        [monitorId, status, ms, minutesAgo, inMaintenance]
    );
}

// Sum across buckets so the test can't flake when it runs near an hour boundary.
async function rollupTotals() {
    const { rows } = await pool.query(
        `SELECT
            COALESCE(SUM(total_checks), 0)::int AS total,
            COALESCE(SUM(up_checks), 0)::int AS up,
            COALESCE(SUM(maintenance_checks), 0)::int AS maintenance
         FROM monitor_rollups_1h
         WHERE monitor_id = $1`,
        [monitorId]
    );
    return rows[0];
}

test('rollup counts maintenance separately and is idempotent', async () => {
    await insert('UP', 100, 10);
    await insert('UP', 300, 11);
    await insert('DOWN', null, 12);
    await insert('DOWN', null, 13, true);

    await rollupRecentMonitorResults(3);
    const first = await rollupTotals();
    expect(first).toEqual({ total: 3, up: 2, maintenance: 1 });

    await rollupRecentMonitorResults(3);
    expect(await rollupTotals()).toEqual(first);
});

test('cleanup rolls up old rows before deleting them and keeps recent rows', async () => {
    await insert('UP', 200, 40 * 24 * 60); // 40 days old
    await insert('UP', 200, 24 * 60);      // 1 day old

    const before = await rollupTotals();
    const summary = await cleanupMonitorResults();
    expect(summary.rawDeleted).toBe(1);

    const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS n
         FROM monitor_results
         WHERE monitor_id = $1
           AND checked_at < NOW() - INTERVAL '35 days'`,
        [monitorId]
    );
    expect(rows[0].n).toBe(0);

    const after = await rollupTotals();
    expect(after.total).toBe(before.total + 1);

    const recent = await pool.query(
        'SELECT COUNT(*)::int AS n FROM monitor_results WHERE monitor_id = $1',
        [monitorId]
    );
    expect(recent.rows[0].n).toBe(5); // 4 from test 1 + the 1-day-old row
});