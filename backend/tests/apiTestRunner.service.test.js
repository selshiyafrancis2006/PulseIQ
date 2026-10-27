jest.mock('../src/services/httpCheck.service', () => ({
    checkHttp: jest.fn()
}));

const { checkHttp } = require('../src/services/httpCheck.service');
const { runApiTest } = require('../src/services/apiTestRunner.service');

describe('apiTestRunner', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('executes ordered steps and reuses an extracted token', async () => {
        checkHttp
            .mockResolvedValueOnce({
                statusCode: 200,
                body: JSON.stringify({ data: { token: 'secret-token' } })
            })
            .mockResolvedValueOnce({
                statusCode: 200,
                body: JSON.stringify({ data: { id: 42, name: 'PulseIQ' } })
            });

        const result = await runApiTest({
            steps: [
                {
                    name: 'Login',
                    method: 'POST',
                    url: 'https://example.com/login',
                    body: { email: 'test@example.com' },
                    assertions: { status: 200 },
                    extract: { authToken: 'data.token' }
                },
                {
                    name: 'Fetch profile',
                    method: 'GET',
                    url: 'https://example.com/profile',
                    headers: {
                        Authorization: 'Bearer {{authToken}}'
                    },
                    assertions: {
                        status: 200,
                        body: {
                            'data.id': 42,
                            'data.name': 'PulseIQ'
                        }
                    }
                }
            ]
        });

        expect(result.status).toBe('passed');
        expect(result.failedStep).toBeNull();
        expect(result.results).toHaveLength(2);
        expect(result.results.every(step => step.passed)).toBe(true);

        expect(checkHttp).toHaveBeenCalledTimes(2);
        expect(checkHttp.mock.calls[1][0].headers.Authorization)
            .toBe('Bearer secret-token');

        // Secrets must not appear in persisted-ready results.
        expect(JSON.stringify(result)).not.toContain('secret-token');
    });

    test('stops at the first failed assertion', async () => {
        checkHttp.mockResolvedValueOnce({
            statusCode: 503,
            body: JSON.stringify({ message: 'Unavailable' })
        });

        const result = await runApiTest({
            steps: [
                {
                    name: 'Check service',
                    method: 'GET',
                    url: 'https://example.com/health',
                    assertions: { status: 200 }
                },
                {
                    name: 'Must not run',
                    method: 'GET',
                    url: 'https://example.com/profile'
                }
            ]
        });

        expect(result.status).toBe('failed');
        expect(result.failedStep).toBe(1);
        expect(result.results).toHaveLength(1);
        expect(result.results[0].passed).toBe(false);
        expect(checkHttp).toHaveBeenCalledTimes(1);
    });

    test('stops when a required extraction is missing', async () => {
        checkHttp.mockResolvedValueOnce({
            statusCode: 200,
            body: JSON.stringify({ data: {} })
        });

        const result = await runApiTest({
            steps: [
                {
                    name: 'Login',
                    method: 'POST',
                    url: 'https://example.com/login',
                    extract: { authToken: 'data.token' }
                },
                {
                    name: 'Profile',
                    method: 'GET',
                    url: 'https://example.com/profile',
                    headers: {
                        Authorization: 'Bearer {{authToken}}'
                    }
                }
            ]
        });

        expect(result.status).toBe('failed');
        expect(result.failedStep).toBe(1);
        expect(result.results).toHaveLength(1);
        expect(result.results[0].assertions).toContainEqual({
            type: 'extract',
            path: 'data.token',
            passed: false
        });
        expect(checkHttp).toHaveBeenCalledTimes(1);
    });

    test('does not commit partial extractions when a step fails', async () => {
        checkHttp.mockResolvedValueOnce({
            statusCode: 200,
            body: JSON.stringify({
                data: { token: 'temporary-secret' }
            })
        });

        const result = await runApiTest({
            steps: [
                {
                    name: 'Extract values',
                    method: 'POST',
                    url: 'https://example.com/login',
                    extract: {
                        authToken: 'data.token',
                        missingValue: 'data.missing'
                    }
                },
                {
                    name: 'Must not run',
                    method: 'GET',
                    url: 'https://example.com/profile',
                    headers: {
                        Authorization: 'Bearer {{authToken}}'
                    }
                }
            ]
        });

        expect(result.status).toBe('failed');
        expect(result.failedStep).toBe(1);
        expect(result.results).toHaveLength(1);
        expect(checkHttp).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(result)).not.toContain('temporary-secret');
    });
    test('does not expose request errors in results', async () => {
        checkHttp.mockRejectedValueOnce(
            new Error('Request failed for https://example.com/?token=secret')
        );

        const result = await runApiTest({
            steps: [
                {
                    method: 'GET',
                    url: 'https://example.com/?token=secret'
                }
            ]
        });

        expect(result.status).toBe('failed');
        expect(result.failedStep).toBe(1);
        expect(JSON.stringify(result)).not.toContain('token=secret');
        expect(JSON.stringify(result)).not.toContain('Request failed for');
    });

    test('rejects more than ten steps before sending requests', async () => {
        const steps = Array.from({ length: 11 }, () => ({
            method: 'GET',
            url: 'https://example.com'
        }));

        await expect(runApiTest({ steps })).rejects.toThrow(
            'steps must contain between 1 and 10 steps'
        );

        expect(checkHttp).not.toHaveBeenCalled();
    });

    test('rejects unsupported methods before sending requests', async () => {
        await expect(runApiTest({
            steps: [{
                method: 'TRACE',
                url: 'https://example.com'
            }]
        })).rejects.toThrow('unsupported HTTP method');

        expect(checkHttp).not.toHaveBeenCalled();
    });
});

