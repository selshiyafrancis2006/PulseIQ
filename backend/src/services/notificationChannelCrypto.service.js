const crypto = require('crypto');

const ENCRYPTED_PREFIX = 'enc:v1:';
const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey() {
    const configured = process.env.NOTIFICATION_ENCRYPTION_KEY;

    if (typeof configured !== 'string' || !configured) {
        throw new Error('NOTIFICATION_ENCRYPTION_KEY is not configured');
    }

    const key = Buffer.from(configured, 'base64');

    if (
        key.length !== 32 ||
        key.toString('base64') !== configured
    ) {
        throw new Error(
            'NOTIFICATION_ENCRYPTION_KEY must be a valid base64-encoded 32-byte key'
        );
    }

    return key;
}

function encryptUrl(value) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error('A non-empty URL is required for encryption');
    }

    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([
        cipher.update(value, 'utf8'),
        cipher.final()
    ]);

    const authTag = cipher.getAuthTag();

    return [
        ENCRYPTED_PREFIX.slice(0, -1),
        iv.toString('base64'),
        authTag.toString('base64'),
        encrypted.toString('base64')
    ].join(':');
}

function decryptUrl(value) {
    if (typeof value !== 'string' || !value.startsWith(ENCRYPTED_PREFIX)) {
        throw new Error('Notification channel URL is not encrypted or has an unsupported format');
    }

    const parts = value.split(':');

    if (parts.length !== 5 || parts[1] !== 'v1') {
        throw new Error('Invalid encrypted notification channel URL format');
    }

    const [, , ivEncoded, tagEncoded, encryptedEncoded] = parts;

    const iv = Buffer.from(ivEncoded, 'base64');
    const authTag = Buffer.from(tagEncoded, 'base64');
    const encrypted = Buffer.from(encryptedEncoded, 'base64');

    if (
        iv.length !== 12 ||
        authTag.length !== 16 ||
        !encrypted.length ||
        iv.toString('base64') !== ivEncoded ||
        authTag.toString('base64') !== tagEncoded ||
        encrypted.toString('base64') !== encryptedEncoded
    ) {
        throw new Error('Invalid encrypted notification channel URL data');
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
    ]).toString('utf8');
}

module.exports = {
    encryptUrl,
    decryptUrl
};
