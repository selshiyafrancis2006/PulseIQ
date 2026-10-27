jest.mock('../src/services/auth.service', () => ({
    register: jest.fn(),
    login: jest.fn()
}));

const authService = require('../src/services/auth.service');
const {
    registerUser,
    loginUser
} = require('../src/controllers/auth.controller');

function createResponse() {
    const res = {
        status: jest.fn(),
        json: jest.fn()
    };

    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);

    return res;
}

describe('Authentication controller unexpected errors', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('registration returns 500 when the service fails unexpectedly', async () => {
        authService.register.mockRejectedValue(
            new Error('DATABASE_UNAVAILABLE')
        );

        const req = {
            body: {
                email: 'test@test.dev',
                password: 'password123'
            }
        };
        const res = createResponse();

        await registerUser(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Registration failed'
        });
    });

    test('login returns 500 when the service fails unexpectedly', async () => {
        authService.login.mockRejectedValue(
            new Error('DATABASE_UNAVAILABLE')
        );

        const req = {
            body: {
                email: 'test@test.dev',
                password: 'password123'
            }
        };
        const res = createResponse();

        await loginUser(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Login failed'
        });
    });
});
