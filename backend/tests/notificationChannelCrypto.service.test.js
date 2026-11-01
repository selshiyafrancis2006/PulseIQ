const crypto = require('crypto');

const {
    encryptUrl,
    decryptUrl
} = require('../src/services/notificationChannelCrypto.service');

describe('notificationChannelCrypto.service', () => {
    const originalKey = process.env.NOTIFICATION_ENCRYPTION_KEY;

    beforeEach(() => {
        process.env.NOTIFICATION_ENCRYPTION_KEY =
            crypto.randomBytes(32).toString('base64');
    });

    afterAll(() => {
        if (originalKey === undefined) {
            delete process.env.NOTIFICATION_ENCRYPTION_KEY;
        } else {
            process.env.NOTIFICATION_ENCRYPTION_KEY = originalKey;
        }
    });

    test('encrypts and decrypts a Slack webhook URL', () => {
        const url = 'https://hooks.slack.com/services/test/example/secret';

        const encrypted = encryptUrl(url);

        expect(encrypted).not.toBe(url);
        expect(encrypted).toMatch(/^enc:v1:/);
        expect(decryptUrl(encrypted)).toBe(url);
    });

    test('uses a different random IV for each encryption', () => {
        const url = 'https://hooks.slack.com/services/test/example/secret';

        expect(encryptUrl(url)).not.toBe(encryptUrl(url));
    });

    test('rejects an incorrect encryption key', () => {
        const url = encryptUrl('https://hooks.slack.com/services/test/example/secret');

        process.env.NOTIFICATION_ENCRYPTION_KEY =
            crypto.randomBytes(32).toString('base64');

        expect(() => decryptUrl(url)).toThrow();
    });

    test('rejects tampered ciphertext', () => {
        const encrypted = encryptUrl('https://hooks.slack.com/services/test/example/secret');
        const parts = encrypted.split(':');

        parts[3] = Buffer.alloc(16, 1).toString('base64');

        expect(() => decryptUrl(parts.join(':'))).toThrow();
    });

    test('rejects plaintext URLs', () => {
        expect(() => decryptUrl(
            'https://hooks.slack.com/services/test/example/secret'
        )).toThrow('not encrypted');
    });

    test('rejects malformed encrypted data', () => {
        expect(() => decryptUrl('enc:v1:invalid')).toThrow();
    });

    test('rejects empty URLs', () => {
        expect(() => encryptUrl('')).toThrow();
        expect(() => encryptUrl('   ')).toThrow();
    });

    test('rejects a missing encryption key', () => {
        delete process.env.NOTIFICATION_ENCRYPTION_KEY;

        expect(() => encryptUrl('https://example.com/webhook'))
            .toThrow('NOTIFICATION_ENCRYPTION_KEY is not configured');
    });

    test('rejects an invalid encryption key length', () => {
        process.env.NOTIFICATION_ENCRYPTION_KEY =
            Buffer.alloc(16).toString('base64');

        expect(() => encryptUrl('https://example.com/webhook'))
            .toThrow('32-byte key');
    });
});
