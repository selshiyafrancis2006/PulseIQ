jest.mock('../src/services/httpCheck.service', () => ({
    checkHttp: jest.fn()
}));

const { checkHttp } = require('../src/services/httpCheck.service');
const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

const validSteps = () => [
    {
        name: 'Check API health',
        method: 'GET',
        url: 'https://example.com/health',
        assertions: {
            status: 200,
            body: {
                status: 'ok'
            }
        }
    }
];

let owner;
let other;
let ownedTestId;

beforeAll(async () => {
    await resetDb();
    owner = await createUser();
    other = await createUser();
});

afterAll(async () => {
    await pool.end();
});

beforeEach(() => {
    jest.clearAllMocks();
});

describe('API tests integration', () => {
    test('requires authentication', async () => {
        const res = await request(app).get('/api/api-tests');

        expect(res.status).toBe(401);
    });

    test('creates, lists, retrieves, updates and deletes an API test', async () => {
        const created = await request(app)
            .post('/api/api-tests')
            .set(authHeader(owner.token))
            .send({
                name: 'Health API check',
                steps: validSteps()
            });

        expect(created.status).toBe(201);
        expect(created.body.name).toBe('Health API check');
        expect(created.body.steps).toHaveLength(1);
        expect(created.body.id).toBeTruthy();

        ownedTestId = created.body.id;

        const list = await request(app)
            .get('/api/api-tests')
            .set(authHeader(owner.token));

        expect(list.status).toBe(200);
        expect(list.body.some(item => item.id === ownedTestId)).toBe(true);

        const fetched = await request(app)
            .get(`/api/api-tests/${ownedTestId}`)
            .set(authHeader(owner.token));

        expect(fetched.status).toBe(200);
        expect(fetched.body.name).toBe('Health API check');

        const updated = await request(app)
            .patch(`/api/api-tests/${ownedTestId}`)
            .set(authHeader(owner.token))
            .send({ name: 'Updated health check' });

        expect(updated.status).toBe(200);
        expect(updated.body.name).toBe('Updated health check');

        const deleted = await request(app)
            .delete(`/api/api-tests/${ownedTestId}`)
            .set(authHeader(owner.token));

        expect(deleted.status).toBe(204);

        const missing = await request(app)
            .get(`/api/api-tests/${ownedTestId}`)
            .set(authHeader(owner.token));

        expect(missing.status).toBe(404);
    });

    test('rejects API test definitions larger than 100 KB', async () => {
        const oversizedSteps = [{
            name: 'Oversized payload',
            method: 'POST',
            url: 'https://example.com',
            body: { data: 'x'.repeat(101 * 1024) }
        }];

        const res = await request(app)
            .post('/api/api-tests')
            .set(authHeader(owner.token))
            .send({ name: 'Oversized definition', steps: oversizedSteps });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/100 KB/);
    });

    test('rejects oversized definitions on update', async () => {
        const created = await request(app)
            .post('/api/api-tests')
            .set(authHeader(owner.token))
            .send({ name: 'Valid definition', steps: validSteps() });

        expect(created.status).toBe(201);

        const res = await request(app)
            .patch(`/api/api-tests/${created.body.id}`)
            .set(authHeader(owner.token))
            .send({
                steps: [{
                    name: 'Oversized payload',
                    method: 'POST',
                    url: 'https://example.com',
                    body: { data: 'x'.repeat(101 * 1024) }
                }]
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/100 KB/);
    });

    test('returns 400 for malformed JSON request bodies', async () => {
        const res = await request(app)
            .post('/api/api-tests')
            .set(authHeader(owner.token))
            .set('Content-Type', 'application/json')
            .send('{"name":');

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid JSON request body');
    });
    test('rejects invalid step definitions without making HTTP requests', async () => {
        const res = await request(app)
            .post('/api/api-tests')
            .set(authHeader(owner.token))
            .send({
                name: 'Invalid method',
                steps: [{
                    method: 'TRACE',
                    url: 'https://example.com'
                }]
            });

        expect(res.status).toBe(400);
        expect(checkHttp).not.toHaveBeenCalled();
    });

    test('executes a test and persists its run history without response secrets', async () => {
        const created = await request(app)
            .post('/api/api-tests')
            .set(authHeader(owner.token))
            .send({
                name: 'Persisted run test',
                steps: validSteps()
            });

        expect(created.status).toBe(201);

        checkHttp.mockResolvedValueOnce({
            statusCode: 200,
            body: JSON.stringify({
                status: 'ok',
                token: 'do-not-persist-this-token'
            })
        });

        const executed = await request(app)
            .post(`/api/api-tests/${created.body.id}/run`)
            .set(authHeader(owner.token));

        expect(executed.status).toBe(200);
        expect(executed.body.status).toBe('passed');
        expect(executed.body.api_test_id).toBe(created.body.id);
        expect(JSON.stringify(executed.body))
            .not.toContain('do-not-persist-this-token');

        const history = await request(app)
            .get(`/api/api-tests/${created.body.id}/runs`)
            .set(authHeader(owner.token));

        expect(history.status).toBe(200);
        expect(history.body).toHaveLength(1);
        expect(history.body[0].status).toBe('passed');
        expect(JSON.stringify(history.body))
            .not.toContain('do-not-persist-this-token');
    });

    test('persists failed runs and stops after the failed step', async () => {
        const created = await request(app)
            .post('/api/api-tests')
            .set(authHeader(owner.token))
            .send({
                name: 'Failed run test',
                steps: [
                    {
                        name: 'Expected failure',
                        method: 'GET',
                        url: 'https://example.com/unavailable',
                        assertions: { status: 200 }
                    },
                    {
                        name: 'Must not execute',
                        method: 'GET',
                        url: 'https://example.com/next'
                    }
                ]
            });

        expect(created.status).toBe(201);

        checkHttp.mockResolvedValueOnce({
            statusCode: 503,
            body: '{"message":"Unavailable"}'
        });

        const executed = await request(app)
            .post(`/api/api-tests/${created.body.id}/run`)
            .set(authHeader(owner.token));

        expect(executed.status).toBe(200);
        expect(executed.body.status).toBe('failed');
        expect(executed.body.failed_step).toBe(1);
        expect(executed.body.results).toHaveLength(1);
        expect(checkHttp).toHaveBeenCalledTimes(1);

        const history = await request(app)
            .get(`/api/api-tests/${created.body.id}/runs`)
            .set(authHeader(owner.token));

        expect(history.status).toBe(200);
        expect(history.body).toHaveLength(1);
        expect(history.body[0].status).toBe('failed');
    });

    test('prevents another user from viewing, updating, deleting or running a test', async () => {
        const created = await request(app)
            .post('/api/api-tests')
            .set(authHeader(owner.token))
            .send({
                name: 'Owner-only test',
                steps: validSteps()
            });

        expect(created.status).toBe(201);
        const id = created.body.id;

        const get = await request(app)
            .get(`/api/api-tests/${id}`)
            .set(authHeader(other.token));

        const update = await request(app)
            .patch(`/api/api-tests/${id}`)
            .set(authHeader(other.token))
            .send({ name: 'Unauthorized update' });

        const run = await request(app)
            .post(`/api/api-tests/${id}/run`)
            .set(authHeader(other.token));

        const history = await request(app)
            .get(`/api/api-tests/${id}/runs`)
            .set(authHeader(other.token));

        const remove = await request(app)
            .delete(`/api/api-tests/${id}`)
            .set(authHeader(other.token));

        expect(get.status).toBe(404);
        expect(update.status).toBe(404);
        expect(run.status).toBe(404);
        expect(history.status).toBe(404);
        expect(remove.status).toBe(404);
        expect(checkHttp).not.toHaveBeenCalled();

        const stillOwned = await request(app)
            .get(`/api/api-tests/${id}`)
            .set(authHeader(owner.token));

        expect(stillOwned.status).toBe(200);
        expect(stillOwned.body.name).toBe('Owner-only test');
    });
});

