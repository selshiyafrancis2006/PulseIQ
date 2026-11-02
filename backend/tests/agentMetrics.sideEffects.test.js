// Alerting, anomaly detection and the live broadcast run after the metric is
// saved. A failure in any of them must not make the agent think ingestion
// failed (it would retry and create duplicates), nor skip the other steps.

jest.mock('../src/services/alert.service', () => ({
    evaluateAlerts: jest.fn()
}));
jest.mock('../src/services/baseline.service', () => ({
    detectAnomalies: jest.fn(),
    recomputeBaselines: jest.fn()
}));
jest.mock('../src/services/websocket.service', () => ({
    setWSS: jest.fn(),
    broadcastMetrics: jest.fn()
}));

const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

const { evaluateAlerts } = require('../src/services/alert.service');
const { detectAnomalies } = require('../src/services/baseline.service');
const { broadcastMetrics } = require('../src/services/websocket.service');

const validMetrics = {
    cpu_usage: 10,
    memory_usage: 20,
    disk_usage: 30,
    network_in: 40,
    network_out: 50
};

let apiKey;
let hostId;
let errorSpy;

beforeAll(async () => {
    await resetDb();

    const user = await createUser();
    const res = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(user.token))
        .send({ name: 'side-effects-host' });

    hostId = res.body.id;
    apiKey = res.body.api_key;
});

afterAll(async () => {
    await pool.end();
});

beforeEach(async () => {
    jest.clearAllMocks();
    evaluateAlerts.mockResolvedValue();
    detectAnomalies.mockResolvedValue();
    broadcastMetrics.mockReturnValue();
    await pool.query('TRUNCATE metrics RESTART IDENTITY');
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    errorSpy.mockRestore();
});

const send = () =>
    request(app).post('/api/agent/metrics').set('x-api-key', apiKey).send(validMetrics);

const storedCount = async () =>
    Number((await pool.query(
        'SELECT COUNT(*) FROM metrics WHERE host_id = $1', [hostId]
    )).rows[0].count);

test('runs all three post-ingestion steps with the saved row', async () => {
    const res = await send();

    expect(res.status).toBe(201);
    for (const step of [evaluateAlerts, detectAnomalies, broadcastMetrics]) {
        expect(step).toHaveBeenCalledTimes(1);
        expect(step).toHaveBeenCalledWith(expect.objectContaining({
            id: res.body.id,
            host_id: hostId,
            cpu_usage: 10
        }));
    }
});

test('a failing alert evaluation does not fail ingestion or skip the other steps', async () => {
    evaluateAlerts.mockRejectedValue(new Error('alert engine down'));

    const res = await send();

    expect(res.status).toBe(201);
    expect(await storedCount()).toBe(1);
    expect(detectAnomalies).toHaveBeenCalledTimes(1);
    expect(broadcastMetrics).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('evaluateAlerts'),
        expect.any(Error)
    );
});

test('a failing anomaly detection does not fail ingestion or skip the broadcast', async () => {
    detectAnomalies.mockRejectedValue(new Error('baseline table missing'));

    const res = await send();

    expect(res.status).toBe(201);
    expect(evaluateAlerts).toHaveBeenCalledTimes(1);
    expect(broadcastMetrics).toHaveBeenCalledTimes(1);
});

test('a failing broadcast does not fail ingestion', async () => {
    broadcastMetrics.mockImplementation(() => {
        throw new Error('socket closed');
    });

    const res = await send();

    expect(res.status).toBe(201);
    expect(await storedCount()).toBe(1);
});

test('invalid readings trigger none of the post-ingestion steps', async () => {
    const res = await request(app)
        .post('/api/agent/metrics')
        .set('x-api-key', apiKey)
        .send({ ...validMetrics, cpu_usage: 500 });

    expect(res.status).toBe(400);
    expect(evaluateAlerts).not.toHaveBeenCalled();
    expect(detectAnomalies).not.toHaveBeenCalled();
    expect(broadcastMetrics).not.toHaveBeenCalled();
});