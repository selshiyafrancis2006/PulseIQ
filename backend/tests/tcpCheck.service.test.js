const { EventEmitter } = require('node:events');
const { checkTcp } = require('../src/services/tcpCheck.service');

function createMockSocket() {
    const socket = new EventEmitter();
    socket.setTimeout = jest.fn();
    socket.destroy = jest.fn();
    return socket;
}

describe('checkTcp', () => {
    const monitor = {
        tcp_host: 'example.com',
        tcp_port: 443
    };

    const validatedTarget = {
        hostname: 'example.com',
        port: 443,
        addresses: [{ address: '93.184.216.34', family: 4 }],
        dnsTimeMs: 2
    };

    test('connects to the validated IP and returns timing data', async () => {
        const socket = createMockSocket();
        const createConnection = jest.fn(() => socket);
        const validateTarget = jest.fn().mockResolvedValue(validatedTarget);

        const resultPromise = checkTcp(monitor, {
            validateTarget,
            createConnection
        });

        // Allow async target validation to finish and register socket listeners.
        await Promise.resolve();
        await Promise.resolve();

        expect(createConnection).toHaveBeenCalledWith({
            host: '93.184.216.34',
            port: 443,
            family: 4
        });
        expect(socket.setTimeout).toHaveBeenCalledWith(10000, expect.any(Function));

        socket.emit('connect');

        const result = await resultPromise;

        expect(result.responseTimeMs).toEqual(expect.any(Number));
        expect(result.connectTimeMs).toEqual(expect.any(Number));
        expect(result.dnsTimeMs).toBe(2);
        expect(socket.destroy).toHaveBeenCalled();
    });

    test('rejects when target validation fails without opening a socket', async () => {
        const createConnection = jest.fn();
        const validateTarget = jest.fn().mockRejectedValue(
            new Error('TCP monitor hostname resolves to a non-public IP address')
        );

        await expect(
            checkTcp(monitor, { validateTarget, createConnection })
        ).rejects.toThrow(
            'TCP monitor hostname resolves to a non-public IP address'
        );

        expect(createConnection).not.toHaveBeenCalled();
    });

    test('rejects if the validated target has no addresses', async () => {
        const createConnection = jest.fn();
        const validateTarget = jest.fn().mockResolvedValue({
            ...validatedTarget,
            addresses: []
        });

        await expect(
            checkTcp(monitor, { validateTarget, createConnection })
        ).rejects.toThrow(
            'TCP monitor target has no validated IP addresses'
        );

        expect(createConnection).not.toHaveBeenCalled();
    });

    test('rejects when the socket connection is refused', async () => {
        const socket = createMockSocket();
        const createConnection = jest.fn(() => socket);

        const resultPromise = checkTcp(monitor, {
            validateTarget: jest.fn().mockResolvedValue(validatedTarget),
            createConnection
        });

        await Promise.resolve();
        await Promise.resolve();

        const error = Object.assign(
            new Error('Connection refused'),
            { code: 'ECONNREFUSED' }
        );

        socket.emit('error', error);

        await expect(resultPromise).rejects.toMatchObject({
            code: 'ECONNREFUSED'
        });

        expect(socket.destroy).toHaveBeenCalled();
    });

    test('rejects when the socket times out', async () => {
        const socket = createMockSocket();
        const createConnection = jest.fn(() => socket);

        const resultPromise = checkTcp(monitor, {
            validateTarget: jest.fn().mockResolvedValue(validatedTarget),
            createConnection,
            timeoutMs: 5000
        });

        await Promise.resolve();
        await Promise.resolve();

        expect(socket.setTimeout).toHaveBeenCalledWith(5000, expect.any(Function));

        const timeoutHandler = socket.setTimeout.mock.calls[0][1];
        timeoutHandler();

        await expect(resultPromise).rejects.toMatchObject({
            code: 'ETIMEDOUT'
        });

        expect(socket.destroy).toHaveBeenCalled();
    });

    test.each([999, 31000, 1.5, '5000'])(
        'rejects invalid timeout %s',
        async timeoutMs => {
            const validateTarget = jest.fn();

            await expect(
                checkTcp(monitor, { timeoutMs, validateTarget })
            ).rejects.toThrow(
                'TCP monitor timeout must be between 1000 and 30000 ms'
            );

            expect(validateTarget).not.toHaveBeenCalled();
        }
    );
});



