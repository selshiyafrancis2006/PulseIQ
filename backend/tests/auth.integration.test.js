const {
    app,
    pool,
    request,
    resetDb
} = require('./helpers');

beforeAll(resetDb);

afterAll(async () => {
    await pool.end();
});

describe('Authentication API', () => {
    test('registration rejects a missing email or password', async () => {
        const missingEmail = await request(app)
            .post('/api/auth/register')
            .send({ password: 'password123' });

        expect(missingEmail.status).toBe(400);
        expect(missingEmail.body.error).toBe(
            'Email and password are required'
        );

        const missingPassword = await request(app)
            .post('/api/auth/register')
            .send({ email: 'missing-password@test.dev' });

        expect(missingPassword.status).toBe(400);
        expect(missingPassword.body.error).toBe(
            'Email and password are required'
        );
    });

    test('registration rejects passwords shorter than six characters', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({
                email: 'short-password@test.dev',
                password: '12345'
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe(
            'Password must be at least 6 characters'
        );
    });

    test('a new user can register and receives a token', async () => {
        const email = `register-${Date.now()}@test.dev`;

        const res = await request(app)
            .post('/api/auth/register')
            .send({ email, password: 'password123' });

        expect(res.status).toBe(200);
        expect(res.body.email).toBe(email);
        expect(typeof res.body.token).toBe('string');
        expect(res.body.token.length).toBeGreaterThan(0);
    });

    test('registration rejects an email that is already registered', async () => {
        const email = `duplicate-${Date.now()}@test.dev`;
        const payload = { email, password: 'password123' };

        const first = await request(app)
            .post('/api/auth/register')
            .send(payload);

        expect(first.status).toBe(200);

        const duplicate = await request(app)
            .post('/api/auth/register')
            .send(payload);

        expect(duplicate.status).toBe(400);
        expect(duplicate.body.error).toBe('Email already registered');
    });

    test('login rejects a missing email or password', async () => {
        const missingEmail = await request(app)
            .post('/api/auth/login')
            .send({ password: 'password123' });

        expect(missingEmail.status).toBe(400);
        expect(missingEmail.body.error).toBe(
            'Email and password are required'
        );

        const missingPassword = await request(app)
            .post('/api/auth/login')
            .send({ email: 'missing-password@test.dev' });

        expect(missingPassword.status).toBe(400);
        expect(missingPassword.body.error).toBe(
            'Email and password are required'
        );
    });

    test('a registered user can log in with the correct password', async () => {
        const email = `login-${Date.now()}@test.dev`;

        const registration = await request(app)
            .post('/api/auth/register')
            .send({ email, password: 'password123' });

        expect(registration.status).toBe(200);

        const login = await request(app)
            .post('/api/auth/login')
            .send({ email, password: 'password123' });

        expect(login.status).toBe(200);
        expect(login.body.email).toBe(email);
        expect(typeof login.body.token).toBe('string');
        expect(login.body.token.length).toBeGreaterThan(0);
    });

    test('login rejects an incorrect password', async () => {
        const email = `wrong-password-${Date.now()}@test.dev`;

        await request(app)
            .post('/api/auth/register')
            .send({ email, password: 'password123' });

        const res = await request(app)
            .post('/api/auth/login')
            .send({ email, password: 'incorrect123' });

        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Invalid email or password');
    });

    test('login rejects an email that does not exist', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({
                email: `unknown-${Date.now()}@test.dev`,
                password: 'password123'
            });

        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Invalid email or password');
    });
});
