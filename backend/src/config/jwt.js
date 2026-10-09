const isProduction = process.env.NODE_ENV === 'production';
const MIN_SECRET_LENGTH = 32;

let JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {

    if (isProduction) {
        throw new Error(
            'JWT_SECRET must be set when NODE_ENV=production. Generate one with: ' +
            "node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
        );
    }

    console.warn(
        '⚠️  JWT_SECRET is not set in .env — using an insecure default. ' +
        'Set JWT_SECRET in your .env file before deploying.'
    );

    JWT_SECRET = 'pulseiq_secret_key';

} else if (isProduction && JWT_SECRET.length < MIN_SECRET_LENGTH) {

    throw new Error(
        `JWT_SECRET is too short for production (minimum ${MIN_SECRET_LENGTH} characters).`
    );

}

module.exports = JWT_SECRET;