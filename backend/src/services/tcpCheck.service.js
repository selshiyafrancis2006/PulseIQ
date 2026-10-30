const net = require('node:net');
const { performance } = require('node:perf_hooks');
const {
    validateMonitorTcpTarget
} = require('./urlSecurity.service');

async function checkTcp(monitor, options = {}) {
    const timeoutMs = options.timeoutMs ?? 10000;

    if (
        !Number.isInteger(timeoutMs) ||
        timeoutMs < 1000 ||
        timeoutMs > 30000
    ) {
        throw new Error('TCP monitor timeout must be between 1000 and 30000 ms');
    }

    const startedAt = performance.now();

    const validateTarget =
        options.validateTarget ?? validateMonitorTcpTarget;

    const target = await validateTarget(
        monitor.tcp_host,
        monitor.tcp_port
    );

    if (!target.addresses || target.addresses.length === 0) {
        throw new Error('TCP monitor target has no validated IP addresses');
    }

    // Connect to the validated IP directly. Do not resolve the hostname again.
    const address = target.addresses[0];

    return new Promise((resolve, reject) => {
        let settled = false;
        let socket;

        const finish = (error, result) => {
            if (settled) return;
            settled = true;

            if (socket) {
                socket.destroy();
            }

            if (error) {
                reject(error);
            } else {
                resolve(result);
            }
        };

        try {
            const createConnection =
                options.createConnection ?? net.createConnection;

            socket = createConnection({
                host: address.address,
                port: target.port,
                family: net.isIP(address.address)
            });

            socket.setTimeout(timeoutMs, () => {
                const error = new Error('TCP connection timed out');
                error.code = 'ETIMEDOUT';
                finish(error);
            });

            socket.once('connect', () => {
                const connectedAt = performance.now();

                finish(null, {
                    responseTimeMs: Math.max(
                        0,
                        Math.round(connectedAt - startedAt)
                    ),
                    connectTimeMs: Math.max(
                        0,
                        Number((connectedAt - startedAt).toFixed(2))
                    ),
                    dnsTimeMs: target.dnsTimeMs ?? null
                });
            });

            socket.once('error', error => {
                finish(error);
            });
        } catch (error) {
            finish(error);
        }
    });
}

module.exports = { checkTcp };
