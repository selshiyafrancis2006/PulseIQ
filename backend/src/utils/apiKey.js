const crypto = require('crypto');

// Keys are random UUIDs (122 bits of entropy), so a fast hash is enough:
// there is nothing to brute-force, and a slow hash like bcrypt would only
// add latency to every metrics request.
function generateApiKey() {
    return crypto.randomUUID();
}

function hashApiKey(apiKey) {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
}

module.exports = {
    generateApiKey,
    hashApiKey
};