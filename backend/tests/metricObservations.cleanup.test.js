const { pool, app, request, resetDb, createUser, authHeader } = require('./helpers');
const { cleanupCustomMetrics } = require('../src/services/metricRollup.service');

let hostId;

const insertObservation = (sampleId, ageSql) => pool.query(
    `INSERT INTO metric_observations
        (host_id, sample_id, metric_name, value, unit, tags, collected_at)
     VALUES ($1, $2, 'load_avg', 1, NULL, '{}', NOW() - INTERVAL '${ageSql}')`,
    [hostId, sampleId]
);

beforeAll(async () => {
    await resetDb();
    await pool.query('TRUNCATE metric_observations, custom_metrics RESTART IDENTITY');

    const user = await createUser();
    const res = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(user.token))
        .send({ name: 'cleanup-host' });

    expect(res.status).toBe(201);
    hostId = res.body.id;
});

afterAll(async () => {
    await pool.end();
});

describe('cleanupCustomMetrics also trims metric_observations', () => {
    test('removes observations older than the raw window and keeps newer ones', async () => {
        await insertObservation('11111111-1111-4111-8111-111111111111', '4 days');
        await insertObservation('22222222-2222-4222-8222-222222222222', '2 days');

        await cleanupCustomMetrics();

        const remaining = await pool.query(
            'SELECT sample_id FROM metric_observations WHERE host_id = $1',
            [hostId]
        );

        expect(remaining.rows.map((row) => row.sample_id))
            .toEqual(['22222222-2222-4222-8222-222222222222']);
    });
});