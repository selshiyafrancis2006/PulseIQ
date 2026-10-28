const {
    app,
    pool,
    resetDb,
    createUser,
    authHeader,
    request
} = require('./helpers');

beforeAll(async () => {
    await resetDb();
});

afterAll(async () => {
    await pool.end();
});

async function createMonitor(token, name = 'crud-test-monitor') {
    const response = await request(app)
        .post('/api/monitors')
        .set(authHeader(token))
        .send({
            name,
            url: 'https://example.com',
            interval_seconds: 60,
            tags: ['env:test']
        });

    expect(response.status).toBe(201);
    return response.body;
}

test('owner can update monitor fields', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token);

    const response = await request(app)
        .patch(`/api/monitors/${monitor.id}`)
        .set(authHeader(user.token))
        .send({
            name: 'updated-monitor',
            url: 'https://example.org',
            interval_seconds: 120,
            tags: ['env:prod']
        });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
        id: monitor.id,
        name: 'updated-monitor',
        url: 'https://example.org',
        interval_seconds: 120,
        tags: ['env:prod']
    });
});

test('monitor update rejects an invalid interval', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token);

    const response = await request(app)
        .patch(`/api/monitors/${monitor.id}`)
        .set(authHeader(user.token))
        .send({ interval_seconds: 10 });

    expect(response.status).toBe(400);
});

test('owner can pause and resume a monitor', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token);

    const pauseResponse = await request(app)
        .patch(`/api/monitors/${monitor.id}/pause`)
        .set(authHeader(user.token));

    expect(pauseResponse.status).toBe(200);
    expect(pauseResponse.body.is_active).toBe(false);

    const resumeResponse = await request(app)
        .patch(`/api/monitors/${monitor.id}/resume`)
        .set(authHeader(user.token));

    expect(resumeResponse.status).toBe(200);
    expect(resumeResponse.body.is_active).toBe(true);
});

test('owner can delete a monitor', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token);

    const response = await request(app)
        .delete(`/api/monitors/${monitor.id}`)
        .set(authHeader(user.token));

    expect(response.status).toBe(200);

    const query = await pool.query(
        'SELECT id FROM monitors WHERE id = $1',
        [monitor.id]
    );

    expect(query.rows).toHaveLength(0);
});

test('another user cannot update or delete a monitor', async () => {
    const owner = await createUser();
    const otherUser = await createUser();
    const monitor = await createMonitor(owner.token);

    const updateResponse = await request(app)
        .patch(`/api/monitors/${monitor.id}`)
        .set(authHeader(otherUser.token))
        .send({ name: 'unauthorized-update' });

    expect(updateResponse.status).toBe(404);

    const deleteResponse = await request(app)
        .delete(`/api/monitors/${monitor.id}`)
        .set(authHeader(otherUser.token));

    expect(deleteResponse.status).toBe(404);

    const query = await pool.query(
        'SELECT name FROM monitors WHERE id = $1',
        [monitor.id]
    );

    expect(query.rows[0].name).toBe('crud-test-monitor');
});

test('another user cannot pause or resume a monitor', async () => {
    const owner = await createUser();
    const otherUser = await createUser();
    const monitor = await createMonitor(owner.token);

    const pauseResponse = await request(app)
        .patch(`/api/monitors/${monitor.id}/pause`)
        .set(authHeader(otherUser.token));

    expect(pauseResponse.status).toBe(404);

    const resumeResponse = await request(app)
        .patch(`/api/monitors/${monitor.id}/resume`)
        .set(authHeader(otherUser.token));

    expect(resumeResponse.status).toBe(404);
});

test('owner can fetch monitor details', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token, 'detail-test-monitor');

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}`)
        .set(authHeader(user.token));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
        id: monitor.id,
        name: 'detail-test-monitor',
        url: 'https://example.com'
    });
});

test('monitor detail endpoint validates IDs and enforces ownership', async () => {
    const owner = await createUser();
    const otherUser = await createUser();
    const monitor = await createMonitor(owner.token);

    const invalidResponse = await request(app)
        .get('/api/monitors/not-a-number')
        .set(authHeader(owner.token));
    expect(invalidResponse.status).toBe(400);

    const missingResponse = await request(app)
        .get('/api/monitors/999999999')
        .set(authHeader(owner.token));
    expect(missingResponse.status).toBe(404);

    const forbiddenResponse = await request(app)
        .get(`/api/monitors/${monitor.id}`)
        .set(authHeader(otherUser.token));
    expect(forbiddenResponse.status).toBe(404);
});

// Phase E: TCP monitor creation and validation
test('owner can create a TCP monitor with a validated public IP', async () => {
    const user = await createUser();

    const response = await request(app)
        .post('/api/monitors')
        .set(authHeader(user.token))
        .send({
            name: 'tcp-integration-test',
            monitor_type: 'TCP',
            tcp_host: '1.1.1.1',
            tcp_port: 443,
            interval_seconds: 60,
            tags: ['env:test']
        });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
        name: 'tcp-integration-test',
        monitor_type: 'TCP',
        tcp_host: '1.1.1.1',
        tcp_port: 443,
        url: 'tcp://1.1.1.1:443',
        interval_seconds: 60
    });
});

test('TCP monitor creation rejects an invalid port', async () => {
    const user = await createUser();

    const response = await request(app)
        .post('/api/monitors')
        .set(authHeader(user.token))
        .send({
            name: 'tcp-invalid-port-test',
            monitor_type: 'TCP',
            tcp_host: '1.1.1.1',
            tcp_port: 70000,
            interval_seconds: 60
        });

    expect(response.status).toBe(400);
});

test('TCP monitor creation rejects a private IP target', async () => {
    const user = await createUser();

    const response = await request(app)
        .post('/api/monitors')
        .set(authHeader(user.token))
        .send({
            name: 'tcp-private-ip-test',
            monitor_type: 'TCP',
            tcp_host: '127.0.0.1',
            tcp_port: 443,
            interval_seconds: 60
        });

    expect(response.status).toBe(400);
});

test('HTTP monitor creation defaults monitor_type and TCP fields correctly', async () => {
    const user = await createUser();

    const response = await request(app)
        .post('/api/monitors')
        .set(authHeader(user.token))
        .send({
            name: 'http-default-type-test',
            url: 'https://example.com',
            interval_seconds: 60
        });

    expect(response.status).toBe(201);
    expect(response.body.monitor_type).toBe('HTTP');
    expect(response.body.tcp_host).toBeNull();
    expect(response.body.tcp_port).toBeNull();
});

// Phase E: TCP monitor update regression tests
test('owner can update a TCP monitor target', async () => {
    const user = await createUser();

    const created = await request(app)
        .post('/api/monitors')
        .set(authHeader(user.token))
        .send({
            name: 'tcp-update-test',
            monitor_type: 'TCP',
            tcp_host: '1.1.1.1',
            tcp_port: 443,
            interval_seconds: 60
        });

    expect(created.status).toBe(201);

    const response = await request(app)
        .patch(`/api/monitors/${created.body.id}`)
        .set(authHeader(user.token))
        .send({ tcp_host: '8.8.8.8', tcp_port: 8443 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
        monitor_type: 'TCP',
        tcp_host: '8.8.8.8',
        tcp_port: 8443,
        url: 'tcp://8.8.8.8:8443'
    });
});

test('TCP monitor update rejects a private IP target', async () => {
    const user = await createUser();

    const created = await request(app)
        .post('/api/monitors')
        .set(authHeader(user.token))
        .send({
            name: 'tcp-update-private-test',
            monitor_type: 'TCP',
            tcp_host: '1.1.1.1',
            tcp_port: 443,
            interval_seconds: 60
        });

    expect(created.status).toBe(201);

    const response = await request(app)
        .patch(`/api/monitors/${created.body.id}`)
        .set(authHeader(user.token))
        .send({ tcp_host: '127.0.0.1' });

    expect(response.status).toBe(400);
});

test('TCP monitor update rejects changes to the HTTP URL field', async () => {
    const user = await createUser();

    const created = await request(app)
        .post('/api/monitors')
        .set(authHeader(user.token))
        .send({
            name: 'tcp-update-url-test',
            monitor_type: 'TCP',
            tcp_host: '1.1.1.1',
            tcp_port: 443,
            interval_seconds: 60
        });

    expect(created.status).toBe(201);

    const response = await request(app)
        .patch(`/api/monitors/${created.body.id}`)
        .set(authHeader(user.token))
        .send({ url: 'https://example.com' });

    expect(response.status).toBe(400);
});

test('HTTP monitor update rejects TCP-specific fields', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token);

    const response = await request(app)
        .patch(`/api/monitors/${monitor.id}`)
        .set(authHeader(user.token))
        .send({ tcp_host: '1.1.1.1' });

    expect(response.status).toBe(400);
});

 // Phase E: DNS monitor creation and validation
test('owner can create a DNS monitor with a valid hostname and record type', async () => {
    const user = await createUser();

    const response = await request(app)
        .post('/api/monitors')
        .set(authHeader(user.token))
        .send({
            name: 'dns-integration-test',
            monitor_type: 'DNS',
            dns_hostname: 'example.com',
            dns_record_type: 'A',
            interval_seconds: 60,
            tags: ['env:test']
        });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
        name: 'dns-integration-test',
        monitor_type: 'DNS',
        dns_hostname: 'example.com',
        dns_record_type: 'A',
        url: 'dns://example.com/A',
        interval_seconds: 60,
        tcp_host: null,
        tcp_port: null
    });
});

test('DNS monitor creation rejects localhost', async () => {
    const user = await createUser();

    const response = await request(app)
        .post('/api/monitors')
        .set(authHeader(user.token))
        .send({
            name: 'dns-localhost-test',
            monitor_type: 'DNS',
            dns_hostname: 'localhost',
            dns_record_type: 'A',
            interval_seconds: 60
        });

    expect(response.status).toBe(400);
});

test('DNS monitor creation rejects an unsupported record type', async () => {
    const user = await createUser();

    const response = await request(app)
        .post('/api/monitors')
        .set(authHeader(user.token))
        .send({
            name: 'dns-invalid-record-test',
            monitor_type: 'DNS',
            dns_hostname: 'example.com',
            dns_record_type: 'INVALID',
            interval_seconds: 60
        });

    expect(response.status).toBe(400);
});

// Phase E: DNS monitor update regression tests
test('owner can update a DNS monitor hostname and record type', async () => {
    const user = await createUser();

    const created = await request(app)
        .post('/api/monitors')
        .set(authHeader(user.token))
        .send({
            name: 'dns-update-test',
            monitor_type: 'DNS',
            dns_hostname: 'example.com',
            dns_record_type: 'A',
            interval_seconds: 60
        });

    expect(created.status).toBe(201);

    const response = await request(app)
        .patch(`/api/monitors/${created.body.id}`)
        .set(authHeader(user.token))
        .send({
            dns_hostname: 'example.org',
            dns_record_type: 'AAAA'
        });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
        monitor_type: 'DNS',
        dns_hostname: 'example.org',
        dns_record_type: 'AAAA',
        url: 'dns://example.org/AAAA',
        tcp_host: null,
        tcp_port: null
    });
});

test('DNS monitor update rejects the HTTP URL field', async () => {
    const user = await createUser();

    const created = await request(app)
        .post('/api/monitors')
        .set(authHeader(user.token))
        .send({
            name: 'dns-update-url-test',
            monitor_type: 'DNS',
            dns_hostname: 'example.com',
            interval_seconds: 60
        });

    expect(created.status).toBe(201);

    const response = await request(app)
        .patch(`/api/monitors/${created.body.id}`)
        .set(authHeader(user.token))
        .send({ url: 'https://example.org' });

    expect(response.status).toBe(400);
});

test('HTTP monitor update rejects DNS-specific fields', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token);

    const response = await request(app)
        .patch(`/api/monitors/${monitor.id}`)
        .set(authHeader(user.token))
        .send({ dns_hostname: 'example.com' });

    expect(response.status).toBe(400);
});

test('new monitors default to a failure threshold of 3', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token);

    expect(monitor.failure_threshold).toBe(3);
});

test('monitor can be created with an explicit failure threshold', async () => {
    const user = await createUser();

    const response = await request(app)
        .post('/api/monitors')
        .set(authHeader(user.token))
        .send({
            name: 'threshold-monitor',
            url: 'https://example.com',
            failure_threshold: 5
        });

    expect(response.status).toBe(201);
    expect(response.body.failure_threshold).toBe(5);
});

test.each([0, 11, 2.5, '3', null])(
    'create rejects invalid failure_threshold %p',
    async (value) => {
        const user = await createUser();

        const response = await request(app)
            .post('/api/monitors')
            .set(authHeader(user.token))
            .send({
                name: 'bad-threshold',
                url: 'https://example.com',
                failure_threshold: value
            });

        expect(response.status).toBe(400);
        expect(response.body.message).toMatch(/failure_threshold/);
    }
);

test('owner can update failure_threshold and invalid values are rejected', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token);

    const ok = await request(app)
        .patch(`/api/monitors/${monitor.id}`)
        .set(authHeader(user.token))
        .send({ failure_threshold: 2 });

    expect(ok.status).toBe(200);
    expect(ok.body.failure_threshold).toBe(2);

    const bad = await request(app)
        .patch(`/api/monitors/${monitor.id}`)
        .set(authHeader(user.token))
        .send({ failure_threshold: 0 });

    expect(bad.status).toBe(400);
});