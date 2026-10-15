const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

const validMetrics = (overrides = {}) => ({
    cpu_usage: 10,
    memory_usage: 20,
    disk_usage: 30,
    network_in: 1,
    network_out: 2,
    ...overrides
});

async function register(token, name, tags) {
    const body = tags === undefined ? { name } : { name, tags };

    const response = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(token))
        .send(body);

    expect(response.status).toBe(201);
    return response.body;
}

const sendMetrics = (apiKey, payload) =>
    request(app)
        .post('/api/agent/metrics')
        .set('x-api-key', apiKey)
        .send(payload);

const listHosts = (token, tag) =>
    request(app)
        .get('/api/hosts')
        .query(tag ? { tag } : {})
        .set(authHeader(token));

const getHost = (token, id) =>
    request(app)
        .get(`/api/hosts/${id}`)
        .set(authHeader(token));

const patchHost = (token, id, body) =>
    request(app)
        .patch(`/api/hosts/${id}`)
        .set(authHeader(token))
        .send(body);

beforeAll(async () => {
    await resetDb();
});

afterAll(async () => {
    await pool.end();
});

test('the host list is scoped to the owner, sorted by name, and never exposes key material', async () => {
    const a = await createUser();
    const b = await createUser();

    await register(a.token, 'zeta-host');
    await register(a.token, 'alpha-host');
    await register(b.token, 'beta-only-host');

    const responseA = await listHosts(a.token);
    expect(responseA.status).toBe(200);
    expect(responseA.body.map((host) => host.name)).toEqual([
        'alpha-host',
        'zeta-host'
    ]);

    for (const host of responseA.body) {
        expect(host).not.toHaveProperty('api_key');
        expect(host).not.toHaveProperty('api_key_hash');
    }

    const responseB = await listHosts(b.token);
    expect(responseB.body.map((host) => host.name)).toEqual([
        'beta-only-host'
    ]);
});

test('the tag filter returns only matching hosts of the current user', async () => {
    const a = await createUser();
    const b = await createUser();

    await register(a.token, 'tagged-prod', ['env:prod', 'team:core']);
    await register(a.token, 'tagged-dev', ['env:dev']);
    await register(b.token, 'other-user-prod', ['env:prod']);

    const prod = await listHosts(a.token, 'env:prod');
    expect(prod.status).toBe(200);
    expect(prod.body.map((host) => host.name)).toEqual(['tagged-prod']);

    const core = await listHosts(a.token, 'team:core');
    expect(core.body.map((host) => host.name)).toEqual(['tagged-prod']);

    const unknown = await listHosts(a.token, 'env:staging');
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual([]);
});

test('the host list shows the latest metric values, or null before any metric', async () => {
    const a = await createUser();
    const host = await register(a.token, 'metrics-join-host');

    const before = await listHosts(a.token);
    expect(before.body[0].cpu_usage).toBeNull();
    expect(before.body[0].last_seen_at).toBeNull();

    expect((await sendMetrics(host.api_key, validMetrics({ cpu_usage: 10 }))).status).toBe(201);
    expect(
        (await sendMetrics(
            host.api_key,
            validMetrics({ cpu_usage: 55, memory_usage: 66 })
        )).status
    ).toBe(201);

    const after = await listHosts(a.token);
    expect(after.body[0].cpu_usage).toBe(55);
    expect(after.body[0].memory_usage).toBe(66);
    expect(after.body[0].last_seen_at).not.toBeNull();
});

test('renaming a host to another host\'s name is rejected with 409', async () => {
    const a = await createUser();
    await register(a.token, 'rename-a');
    const second = await register(a.token, 'rename-b');

    const response = await patchHost(a.token, second.id, { name: 'rename-a' });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('A host with this name already exists');

    const unchanged = await getHost(a.token, second.id);
    expect(unchanged.body.name).toBe('rename-b');
});

test('renaming a host to its own name succeeds and names are trimmed', async () => {
    const a = await createUser();
    const host = await register(a.token, 'rename-same');

    const same = await patchHost(a.token, host.id, { name: 'rename-same' });
    expect(same.status).toBe(200);
    expect(same.body.name).toBe('rename-same');

    const trimmed = await patchHost(a.token, host.id, { name: '  rename-trimmed  ' });
    expect(trimmed.status).toBe(200);
    expect(trimmed.body.name).toBe('rename-trimmed');
});

test.each([
    ['a whitespace-only name', { name: '   ' }],
    ['tags that are not a list or string', { tags: 123 }]
])('PATCH rejects %s', async (_description, body) => {
    const a = await createUser();
    const host = await register(a.token, 'patch-invalid-host');

    const response = await patchHost(a.token, host.id, body);

    expect(response.status).toBe(400);
});

test('agent metadata is stored, partial updates keep existing fields, and bad fields are ignored', async () => {
    const a = await createUser();
    const host = await register(a.token, 'metadata-host');

    const first = await sendMetrics(
        host.api_key,
        validMetrics({
            metadata: {
                hostname: 'srv-01',
                os: 'Ubuntu 22.04',
                platform: 'linux',
                arch: 'x64',
                cpu_model: 'Intel Xeon',
                cpu_cores: 8,
                total_memory_mb: 16384,
                ip_address: '10.0.0.5',
                agent_version: '1.2.3',
                boot_time: '2026-10-01T00:00:00.000Z'
            }
        })
    );
    expect(first.status).toBe(201);

    const detail = await getHost(a.token, host.id);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
        hostname: 'srv-01',
        os: 'Ubuntu 22.04',
        platform: 'linux',
        arch: 'x64',
        cpu_model: 'Intel Xeon',
        cpu_cores: 8,
        total_memory_mb: 16384,
        ip_address: '10.0.0.5',
        agent_version: '1.2.3',
        network_in: 1,
        network_out: 2
    });
    expect(new Date(detail.body.boot_time).toISOString()).toBe(
        '2026-10-01T00:00:00.000Z'
    );

    // A later report with one new field and two invalid ones must not wipe
    // what is already stored, and must not fail metric ingestion.
    const second = await sendMetrics(
        host.api_key,
        validMetrics({
            metadata: {
                os: 'Ubuntu 24.04',
                hostname: 12345,
                cpu_cores: -4
            }
        })
    );
    expect(second.status).toBe(201);

    const updated = await getHost(a.token, host.id);
    expect(updated.body.os).toBe('Ubuntu 24.04');
    expect(updated.body.hostname).toBe('srv-01');
    expect(updated.body.cpu_cores).toBe(8);
});