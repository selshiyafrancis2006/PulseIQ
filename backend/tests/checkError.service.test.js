
const { classifyCheckError } = require('../src/services/checkError.service');

describe('classifyCheckError', () => {
    test.each([
        [{ code: 'ECONNABORTED' }, 'TIMEOUT'],
        [{ code: 'ETIMEDOUT' }, 'TIMEOUT'],
        [{ code: 'ENOTFOUND' }, 'DNS'],
        [{ code: 'ENODATA' }, 'DNS'],
        [{ code: 'EAI_AGAIN' }, 'DNS'],
        [{ code: 'ECONNREFUSED' }, 'CONNECTION_REFUSED'],
        [{ code: 'CERT_HAS_EXPIRED' }, 'TLS'],
        [{ code: 'EPROTO' }, 'TLS'],
        [{ message: 'Too many redirects (maximum 3)' }, 'TOO_MANY_REDIRECTS'],
        [{ message: 'Monitor URL resolves to a non-public IP address' }, 'URL_REJECTED'],
        [{ message: 'maxContentLength size of 1000000 exceeded' }, 'RESPONSE_TOO_LARGE'],
        [{ code: 'ECONNRESET' }, 'NETWORK']
    ])('classifies %p', (error, expectedType) => {
        const result = classifyCheckError(error);

        expect(result.errorType).toBe(expectedType);
        expect(result.errorMessage).toEqual(expect.any(String));
        expect(result.errorMessage.length).toBeGreaterThan(0);
    });

    test('does not expose raw error messages', () => {
        const result = classifyCheckError({
            code: 'ECONNRESET',
            message: 'Request failed for https://user:secret@example.com'
        });

        expect(result.errorMessage).not.toContain('secret');
        expect(result.errorMessage).not.toContain('example.com');
    });
});
