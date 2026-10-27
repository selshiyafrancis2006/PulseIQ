const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

let owner;
let other;
let withResults;
let noResults;

beforeAll(async () => {
    await resetDb();
    owner = await createUser();
    other = await createUser();

    const create = async (token, name, extra = {}) => {
        const res = await request(app)
            .post('/api/monitors')
            .set(authHeader(token))
            .send({ name, url: 'https://example.com', ...extra });
        expect(res.status).toBe(201);
        return res.body.id;
    };

    withResults = await create(owner.token, 'has-results', { tags: ['prod'] });
    noResults = await create(owner.token, 'no-results');
    await create(other.token, 'someone-elses');

    // Older DOWN, newer UP: status must reflect the newest row.
    await pool.query(
        `INSERT INTO monitor_results
            (monitor_id, status, response_time_ms, status_code, checked_at)
         VALUES
            ($1, 'DOWN', NULL, 500, NOW() - INTERVAL '10 minutes'),
            ($1, 'UP', 120, 200, NOW() - INTERVAL '1 minute')`,
        [withResults]
    );
});

afterAll(async () => {
    await pool.end();
});

test('returns the latest result per monitor, null fields when none, only own monitors', async () => {
    const res = await request(app)
        .get('/api/monitors/status')
        .set(authHeader(owner.token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const latest = res.body.find((m) => m.id === withResults);
    expect(latest.status).toBe('UP');
    expect(latest.response_time_ms).toBe(120);

    const empty = res.body.find((m) => m.id === noResults);
    expect(empty.status).toBeNull();
    expect(empty.checked_at).toBeNull();
});

test('tag filter still narrows the list', async () => {
    const res = await request(app)
        .get('/api/monitors/status?tag=prod')
        .set(authHeader(owner.token));

    expect(res.status).toBe(200);
    expect(res.body.map((m) => m.id)).toEqual([withResults]);
});