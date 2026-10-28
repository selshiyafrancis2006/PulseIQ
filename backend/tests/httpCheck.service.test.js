
jest.mock('axios', () => ({
    request: jest.fn()
}));

const axios = require('axios');
const { checkHttp } = require('../src/services/httpCheck.service');

describe('checkHttp', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('uses bounded request settings', async () => {
        axios.request.mockResolvedValue({
            status: 200,
            data: 'OK',
            headers: {}
        });

        const result = await checkHttp({
            url: 'https://example.com',
            timeout_ms: 5000
        });

        expect(axios.request).toHaveBeenCalledWith(
            expect.objectContaining({
                timeout: 5000,
                maxRedirects: 0,
                maxContentLength: 1_000_000,
                maxBodyLength: 1_000_000,
                validateStatus: expect.any(Function)
            })
        );

        expect(result.statusCode).toBe(200);
        expect(result.body).toBe('OK');
        expect(result.responseTimeMs).toEqual(expect.any(Number));
        expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
        expect(result.certificateExpiresAt).toBeNull();
        expect(result.certificateDaysRemaining).toBeNull();
    });

    test('passes configured HTTP method, headers, body, and timeout to Axios', async () => {
        axios.request.mockResolvedValue({
            status: 200,
            data: 'created',
            headers: {}
        });

        await checkHttp({
            url: 'https://example.com/api/check',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Monitor-Test': 'pulseiq'
            },
            body: '{"check":true}',
            timeout_ms: 7500
        });

        expect(axios.request).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Monitor-Test': 'pulseiq'
                },
                data: '{"check":true}',
                timeout: 7500,
                maxRedirects: 0,
                proxy: false
            })
        );
    });

    test('returns non-2xx status codes instead of throwing', async () => {
        axios.request.mockResolvedValue({
            status: 503,
            data: 'Service unavailable',
            headers: {}
        });

        const result = await checkHttp({
            url: 'https://example.com'
        });

        expect(result.statusCode).toBe(503);
        expect(result.body).toBe('Service unavailable');
    });

    test('rejects invalid URL schemes', async () => {
        await expect(
            checkHttp({ url: 'file:///etc/passwd' })
        ).rejects.toThrow(
            'Only HTTP/HTTPS URLs without credentials are allowed'
        );

        expect(axios.request).not.toHaveBeenCalled();
    });

    test('rejects URLs containing credentials', async () => {
        await expect(
            checkHttp({ url: 'https://user:pass@example.com' })
        ).rejects.toThrow(
            'Only HTTP/HTTPS URLs without credentials are allowed'
        );

        expect(axios.request).not.toHaveBeenCalled();
    });

    test('rejects invalid timeout values', async () => {
        await expect(
            checkHttp({
                url: 'https://example.com',
                timeout_ms: 60_000
            })
        ).rejects.toThrow(
            'timeout_ms must be between 1 and 30000'
        );

        expect(axios.request).not.toHaveBeenCalled();
    });

    test('follows redirects manually', async () => {
        axios.request
            .mockResolvedValueOnce({
                status: 302,
                data: '',
                headers: { location: '/health' }
            })
            .mockResolvedValueOnce({
                status: 200,
                data: 'healthy',
                headers: {}
            });

        const result = await checkHttp({
            url: 'https://example.com/start'
        });

        expect(axios.request).toHaveBeenCalledTimes(2);
        expect(axios.request.mock.calls[1][0].url)
            .toBe('https://example.com/health');
        expect(result.statusCode).toBe(200);
    });

    test('rejects redirects to disallowed URL schemes', async () => {
        axios.request.mockResolvedValue({
            status: 302,
            data: '',
            headers: { location: 'file:///etc/passwd' }
        });

        await expect(
            checkHttp({ url: 'https://example.com' })
        ).rejects.toThrow('Redirect target uses a disallowed URL');

        expect(axios.request).toHaveBeenCalledTimes(1);
    });

    test('revalidates redirect destinations before making the next request', async () => {
        axios.request.mockResolvedValue({
            status: 302,
            data: '',
            headers: {
                location: 'http://127.0.0.1/private'
            }
        });

        const validateUrl = jest.fn(async input => {
            if (input === 'https://example.com/') {
                return {
                    url: new URL(input),
                    hostname: 'example.com',
                    addresses: [
                        { address: '93.184.216.34' }
                    ],
                    dnsTimeMs: 1
                };
            }

            throw new Error(
                'Monitor URL resolves to a non-public IP address'
            );
        });

        await expect(
            checkHttp(
                { url: 'https://example.com' },
                { validateUrl }
            )
        ).rejects.toThrow(
            'Monitor URL resolves to a non-public IP address'
        );

        expect(validateUrl).toHaveBeenCalledTimes(2);
        expect(validateUrl).toHaveBeenLastCalledWith(
            'http://127.0.0.1/private'
        );
        expect(axios.request).toHaveBeenCalledTimes(1);
    });

    test('rejects redirects beyond the configured limit', async () => {
        axios.request.mockResolvedValue({
            status: 302,
            data: '',
            headers: { location: '/next' }
        });

        await expect(
            checkHttp({ url: 'https://example.com' })
        ).rejects.toThrow(
            'Too many redirects (maximum 3)'
        );

        expect(axios.request).toHaveBeenCalledTimes(4);
    });
});
