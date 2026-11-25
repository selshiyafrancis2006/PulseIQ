const pool = require('../src/config/db');
const { METRIC_NAMES } = require('../src/config/metricRegistry');
const { rollup5Minute, rollup1Hour } = require('../src/services/metricRollup.service');

const columnsOf = async (table) => {
    const result = await pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1`,
        [table]
    );
    return result.rows.map((row) => row.column_name);
};

const capturedSql = async (job) => {
    const client = { query: jest.fn().mockResolvedValue({ rowCount: 0, rows: [] }) };
    await job(client);
    return client.query.mock.calls[0][0];
};

afterAll(async () => {
    await pool.end();
});

// Adding a metric to shared/metrics.json without the matching table columns
// (or the other way round) should fail here, not in production.
describe('metric registry matches the database schema', () => {
    test('the raw metrics table has a column for every registry metric', async () => {
        const columns = await columnsOf('metrics');

        for (const name of METRIC_NAMES) {
            expect(columns).toContain(name);
        }
    });

    test.each(['metric_rollups_5m', 'metric_rollups_1h'])(
        '%s has average, minimum and maximum columns for every registry metric',
        async (table) => {
            const columns = await columnsOf(table);

            for (const name of METRIC_NAMES) {
                expect(columns).toEqual(expect.arrayContaining([
                    `${name}_avg`, `${name}_min`, `${name}_max`
                ]));
            }
        }
    );

    test('the generic metric tables exist', async () => {
        for (const table of [
            'metric_observations',
            'metric_rollups_5m_generic',
            'metric_rollups_1h_generic'
        ]) {
            expect((await columnsOf(table)).length).toBeGreaterThan(0);
        }
    });

    test.each([
        ['rollup5Minute', rollup5Minute],
        ['rollup1Hour', rollup1Hour]
    ])('%s writes every registry metric', async (_label, job) => {
        const sql = await capturedSql(job);

        for (const name of METRIC_NAMES) {
            for (const suffix of ['avg', 'min', 'max']) {
                expect(sql).toContain(`${name}_${suffix} = EXCLUDED.${name}_${suffix}`);
            }
        }
    });
});