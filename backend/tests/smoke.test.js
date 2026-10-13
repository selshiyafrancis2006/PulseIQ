const { app, pool, request, resetDb, createUser, authHeader } = require('./helpers');

beforeAll(resetDb);

afterAll(async () => {
    await pool.end();
});

test('health route responds', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
});


test('responses include Helmet security headers', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
});


test('hosts API rejects requests without a token', async () => {
    const res = await request(app).get('/api/hosts');
    expect(res.status).toBe(401);
});

test('a new user can register and starts with no hosts', async () => {
    const { token } = await createUser();

    const res = await request(app)
        .get('/api/hosts')
        .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
});