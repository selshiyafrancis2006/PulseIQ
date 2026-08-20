const JWT_SECRET = process.env.JWT_SECRET || 'pulseiq_secret_key';

if (!process.env.JWT_SECRET) {
    console.warn(
        '⚠️  JWT_SECRET is not set in .env — using an insecure default. ' +
        'Set JWT_SECRET in your .env file before deploying.'
    );
}

module.exports = JWT_SECRET;