const crypto = require('crypto');
const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

let monitorId;
let hostA;
let hostB;

async function createHost(userId, name) {
    const { rows } = await pool.query(
        `INSERT INTO hosts (name, api_key_hash, user_id)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [name, crypto.randomBytes(32).toString('hex'), userId]
    );
    return rows[0].id;
}

beforeEach(async () => {
    await resetDb();
    const { token } = await createUser();

    const res = await request(app)
        .post('/api/monitors')
        .set(authHeader(token))
        .send({ name: 'locations-test', url: 'https://example.com' });
    expect(res.status).toBe(201);
    monitorId = res.body.id;

    const { rows } = await pool.query(
        'SELECT user_id FROM monitors WHERE id = $1',
        [monitorId]
    );
    const userId = rows[0].user_id;

    hostA = await createHost(userId, 'agent-a');
    hostB = await createHost(userId, 'agent-b');
});

afterAll(async () => {
    await pool.end();
});

test('monitors default to quorum 1 and reject quorum below 1', async () => {
    const { rows } = await pool.query(
        'SELECT quorum FROM monitors WHERE id = $1',
        [monitorId]
    );
    expect(rows[0].quorum).toBe(1);

    await expect(
        pool.query('UPDATE monitors SET quorum = 0 WHERE id = $1', [monitorId])
    ).rejects.toMatchObject({ code: '23514' });
});

test('a host can be listed only once per monitor', async () => {
    await pool.query(
        'INSERT INTO monitor_locations (monitor_id, host_id) VALUES ($1, $2)',
        [monitorId, hostA]
    );

    await expect(
        pool.query(
            'INSERT INTO monitor_locations (monitor_id, host_id) VALUES ($1, $2)',
            [monitorId, hostA]
        )
    ).rejects.toMatchObject({ code: '23505' });
});

test('location results only accept UP or DOWN', async () => {
    await expect(
        pool.query(
            `INSERT INTO monitor_location_results (monitor_id, host_id, status)
             VALUES ($1, $2, 'MAYBE')`,
            [monitorId, hostA]
        )
    ).rejects.toMatchObject({ code: '23514' });
});

test('deleting a host or a monitor removes its location rows and results', async () => {
    for (const hostId of [hostA, hostB]) {
        await pool.query(
            'INSERT INTO monitor_locations (monitor_id, host_id) VALUES ($1, $2)',
            [monitorId, hostId]
        );
        await pool.query(
            `INSERT INTO monitor_location_results
                (monitor_id, host_id, status, response_time_ms)
             VALUES ($1, $2, 'UP', 50)`,
            [monitorId, hostId]
        );
    }

    const counts = async () => {
        const { rows } = await pool.query(
            `SELECT
                (SELECT COUNT(*)::int FROM monitor_locations) AS locations,
                (SELECT COUNT(*)::int FROM monitor_location_results) AS results`
        );
        return rows[0];
    };

    expect(await counts()).toEqual({ locations: 2, results: 2 });

    await pool.query('DELETE FROM hosts WHERE id = $1', [hostB]);
    expect(await counts()).toEqual({ locations: 1, results: 1 });

    await pool.query('DELETE FROM monitors WHERE id = $1', [monitorId]);
    expect(await counts()).toEqual({ locations: 0, results: 0 });
});