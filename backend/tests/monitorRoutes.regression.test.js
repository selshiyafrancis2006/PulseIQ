const {
    app,
    pool,
    resetDb,
    createUser,
    authHeader,
    request
} = require('./helpers');

jest.mock('../src/services/uptime.service', () => {
    const actual = jest.requireActual('../src/services/uptime.service');
    return { ...actual, checkMonitor: jest.fn(actual.checkMonitor) };
});

const { checkMonitor } = require('../src/services/uptime.service');

beforeAll(async () => {
    await resetDb();
});

afterAll(async () => {
    await pool.end();
});

test('GET /api/monitors/test is not a debug endpoint and never runs a check', async () => {
    const user = await createUser();

    const created = await request(app)
        .post('/api/monitors')
        .set(authHeader(user.token))
        .send({
            name: 'debug-route-guard',
            url: 'https://example.com',
            interval_seconds: 60
        });

    expect(created.status).toBe(201);
    checkMonitor.mockClear();

    const response = await request(app)
        .get('/api/monitors/test')
        .set(authHeader(user.token));

    // "test" is now treated as an invalid monitor ID like any other string.
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(checkMonitor).not.toHaveBeenCalled();
});