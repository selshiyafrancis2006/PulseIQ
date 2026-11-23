const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');
const {
    sanitizeProcesses,
    statusForCpu,
    resolveCollectedAt
} = require('../src/services/hostProcesses.service');

let owner;
let other;
let hostId;
let apiKey;

const registerHost = async (user, name) => {
    const res = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(user.token))
        .send({ name });

    expect(res.status).toBe(201);

    return { id: res.body.id, apiKey: res.body.api_key };
};

const sendProcesses = (body, key = apiKey) =>
    request(app)
        .post('/api/agent/processes')
        .set('x-api-key', key)
        .send(body);

const readProcesses = (id, user = owner) =>
    request(app)
        .get(`/api/hosts/${id}/processes`)
        .set(authHeader(user.token));

beforeAll(async () => {
    await resetDb();
    await pool.query('TRUNCATE host_processes');
    owner = await createUser();
    other = await createUser();

    const host = await registerHost(owner, 'proc-host');
    hostId = host.id;
    apiKey = host.apiKey;
});

afterAll(async () => {
    await pool.end();
});

describe('sanitizeProcesses', () => {
    test('keeps good entries and rounds values', () => {
        expect(
            sanitizeProcesses([{ pid: 10, name: ' node ', cpu: 12.3456, memory_mb: 99.6 }])
        ).toEqual([{ pid: 10, name: 'node', cpu: 12.35, memory_mb: 100 }]);
    });

    test('drops malformed, negative and duplicate entries', () => {
        const result = sanitizeProcesses([
            null,
            'x',
            { pid: 1, name: '', cpu: 1, memory_mb: 1 },
            { pid: -1, name: 'neg', cpu: 1, memory_mb: 1 },
            { pid: 2, name: 'bad-cpu', cpu: 'abc', memory_mb: 1 },
            { pid: 3, name: 'null-mem', cpu: 1, memory_mb: null },
            { pid: 4, name: 'ok', cpu: 1, memory_mb: 1 },
            { pid: 4, name: 'dup', cpu: 9, memory_mb: 9 }
        ]);

        expect(result).toEqual([{ pid: 4, name: 'ok', cpu: 1, memory_mb: 1 }]);
    });

    test('limits the list to 50 entries and the name to 255 characters', () => {
        const many = Array.from({ length: 80 }, (_, i) => ({
            pid: i,
            name: 'x'.repeat(400),
            cpu: 1,
            memory_mb: 1
        }));
        const result = sanitizeProcesses(many);

        expect(result).toHaveLength(50);
        expect(result[0].name).toHaveLength(255);
    });

    test('returns an empty list for non-arrays', () => {
        expect(sanitizeProcesses(undefined)).toEqual([]);
        expect(sanitizeProcesses({})).toEqual([]);
    });
});

describe('statusForCpu', () => {
    test('maps cpu use to a label', () => {
        expect(statusForCpu(5)).toBe('Running');
        expect(statusForCpu(1)).toBe('Idle');
        expect(statusForCpu(0.1)).toBe('Sleeping');
    });
});

describe('resolveCollectedAt', () => {
    const now = Date.parse('2026-11-22T10:00:00Z');

    test('uses a valid recent time', () => {
        expect(resolveCollectedAt('2026-11-22T09:59:00Z', now).toISOString())
            .toBe('2026-11-22T09:59:00.000Z');
    });

    test('falls back to now for missing, invalid or far-future times', () => {
        for (const value of [undefined, 'nope', '2026-11-22T11:00:00Z']) {
            expect(resolveCollectedAt(value, now).getTime()).toBe(now);
        }
    });
});

describe('POST /api/agent/processes', () => {
    test('rejects a missing API key', async () => {
        const res = await request(app).post('/api/agent/processes').send({ processes: [] });

        expect(res.status).toBe(401);
    });

    test('rejects a payload without a processes array', async () => {
        expect((await sendProcesses({})).status).toBe(400);
        expect((await sendProcesses({ processes: 'x' })).status).toBe(400);
    });

    test('stores a snapshot and replaces it with the next one', async () => {
        const first = await sendProcesses({
            collected_at: new Date(Date.now() - 20000).toISOString(),
            processes: [{ pid: 1, name: 'old', cpu: 1, memory_mb: 10 }]
        });

        expect(first.status).toBe(201);

        const second = await sendProcesses({
            collected_at: new Date(Date.now() - 10000).toISOString(),
            processes: [
                { pid: 2, name: 'busy', cpu: 40, memory_mb: 200 },
                { pid: 3, name: 'quiet', cpu: 0, memory_mb: 50 }
            ]
        });

        expect(second.status).toBe(201);
        expect(second.body.count).toBe(2);

        const res = await readProcesses(hostId);

        expect(res.status).toBe(200);
        expect(res.body.processes).toEqual([
            { pid: 2, name: 'busy', cpu: 40, memory: 200, status: 'Running' },
            { pid: 3, name: 'quiet', cpu: 0, memory: 50, status: 'Sleeping' }
        ]);
    });

    test('ignores a late retry of an older snapshot', async () => {
        const late = await sendProcesses({
            collected_at: new Date(Date.now() - 600000).toISOString(),
            processes: [{ pid: 9, name: 'stale', cpu: 1, memory_mb: 1 }]
        });

        expect(late.status).toBe(200);
        expect(late.body.stored).toBe(false);

        const res = await readProcesses(hostId);

        expect(res.body.processes.map((p) => p.name)).toEqual(['busy', 'quiet']);
    });
});

describe('GET /api/hosts/:id/processes', () => {
    test('returns an empty list for a host that has not reported yet', async () => {
        const fresh = await registerHost(owner, 'silent-host');
        const res = await readProcesses(fresh.id);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            host_id: fresh.id,
            collected_at: null,
            processes: []
        });
    });

    test("does not show another user's host", async () => {
        expect((await readProcesses(hostId, other)).status).toBe(404);
    });

    test('rejects a bad id and an unknown host', async () => {
        expect((await readProcesses('abc')).status).toBe(404);
        expect((await readProcesses(999999)).status).toBe(404);
    });

    test('requires a login', async () => {
        expect((await request(app).get(`/api/hosts/${hostId}/processes`)).status).toBe(401);
    });
});

describe('the old server-wide process list', () => {
    test('is gone, so it cannot leak the backend server processes', async () => {
        const res = await request(app)
            .get('/api/processes')
            .set(authHeader(owner.token));

        expect(res.status).toBe(404);
    });
});