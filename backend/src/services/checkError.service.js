
function classifyCheckError(error) {
    const code = error?.code;
    const message = String(error?.message || 'Monitor check failed');

    if (
        code === 'ETIMEDOUT' ||
        code === 'ECONNABORTED' ||
        code === 'ERR_SOCKET_CONNECTION_TIMEOUT' ||
        /timeout of \d+ms exceeded/i.test(message)
    ) {
        return {
            errorType: 'TIMEOUT',
            errorMessage: 'The monitor check timed out'
        };
    }

if (
    code === 'ENOTFOUND' ||
    code === 'ENODATA' ||
    code === 'EAI_AGAIN' ||
    /hostname could not be resolved|DNS record was not found/i.test(message)
) {
        return {
            errorType: 'DNS',
            errorMessage: 'The hostname could not be resolved'
        };
    }

    if (
        code === 'ECONNREFUSED'
    ) {
        return {
            errorType: 'CONNECTION_REFUSED',
            errorMessage: 'The target server refused the connection'
        };
    }

    if (
        code === 'CERT_HAS_EXPIRED' ||
        code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
        code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
        code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
        code === 'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE' ||
        code === 'EPROTO' ||
        /certificate|tls|ssl|handshake/i.test(message)
    ) {
        return {
            errorType: 'TLS',
            errorMessage: 'The secure connection failed'
        };
    }

    if (/too many redirects/i.test(message)) {
        return {
            errorType: 'TOO_MANY_REDIRECTS',
            errorMessage: 'The monitor exceeded the redirect limit'
        };
    }

    if (
        /non-public IP|hostname is not allowed|disallowed URL|invalid monitor URL/i.test(message)
    ) {
        return {
            errorType: 'URL_REJECTED',
            errorMessage: 'The monitor URL failed security validation'
        };
    }

    if (
        code === 'ERR_BAD_RESPONSE' ||
        /maxContentLength|maxBodyLength|content length/i.test(message)
    ) {
        return {
            errorType: 'RESPONSE_TOO_LARGE',
            errorMessage: 'The response exceeded the configured size limit'
        };
    }

    return {
        errorType: 'NETWORK',
        errorMessage: 'The monitor request failed'
    };
}

module.exports = { classifyCheckError };
