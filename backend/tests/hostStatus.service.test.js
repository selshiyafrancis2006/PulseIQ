const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

const { checkHostStatus } = require('../src/services/hostStatus.service');

let token;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function registerHost(name) {
    const response = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(token))
        .send({ name });

    expect(response.status).toBe(201);
    return response.body.id;
}

async function setLastSeen(hostId, sqlExpression) {
    // sqlExpression is a fixed string from this file, never user input
    await pool.query(
        `UPDATE hosts SET last_seen_at = ${sqlExpression} WHERE id = $1`,
        [hostId]
    );
}

async function lifecycleEvents(hostId) {
    const result = await pool.query(
        `SELECT metric_name
         FROM alerts
         WHERE host_id = $1
           AND metric_name IN ('host_offline', 'host_recovered')
         ORDER BY id ASC`,
        [hostId]
    );

    return result.rows.map((row) => row.metric_name);
}

beforeAll(async () => {
    await resetDb();
    ({ token } = await createUser());
});

afterAll(async () => {
    await pool.end();
});

test('a host that has never reported produces no lifecycle events', async () => {
    const hostId = await registerHost('never-reported-host');

    await checkHostStatus();

    expect(await lifecycleEvents(hostId)).toEqual([]);
});

test('a recently seen host produces no lifecycle events', async () => {
    const hostId = await registerHost('fresh-host');
    await setLastSeen(hostId, 'NOW()');

    await checkHostStatus();

    expect(await lifecycleEvents(hostId)).toEqual([]);
});

test('offline and recovered events are created once per outage', async () => {
    const hostId = await registerHost('lifecycle-host');

    // Outage 1: host goes stale -> exactly one offline event, even if the
    // job runs several times.
    await setLastSeen(hostId, "NOW() - INTERVAL '120 seconds'");
    await checkHostStatus();
    await checkHostStatus();
    expect(await lifecycleEvents(hostId)).toEqual(['host_offline']);

    // Host reports again -> exactly one recovered event.
    await sleep(50);
    await setLastSeen(hostId, 'NOW()');
    await checkHostStatus();
    await checkHostStatus();
    expect(await lifecycleEvents(hostId)).toEqual([
        'host_offline',
        'host_recovered'
    ]);

    // Outage 2 after recovery -> a new offline event.
    await sleep(50);
    await setLastSeen(hostId, "NOW() - INTERVAL '120 seconds'");
    await checkHostStatus();
    expect(await lifecycleEvents(hostId)).toEqual([
        'host_offline',
        'host_recovered',
        'host_offline'
    ]);
});