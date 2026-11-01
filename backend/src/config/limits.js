// Per-user resource limits. Read on every call so they can be tuned with
// environment variables (and changed in tests) without code changes.

const DEFAULT_MAX_MONITORS_PER_USER = 100;
const MIN_MAX_MONITORS_PER_USER = 1;
const MAX_ALLOWED_MONITORS_PER_USER = 10000;

function getMaxMonitorsPerUser() {
    const configured = Number(process.env.MAX_MONITORS_PER_USER);

    return Number.isInteger(configured) &&
        configured >= MIN_MAX_MONITORS_PER_USER &&
        configured <= MAX_ALLOWED_MONITORS_PER_USER
        ? configured
        : DEFAULT_MAX_MONITORS_PER_USER;
}

module.exports = {
    getMaxMonitorsPerUser,
    DEFAULT_MAX_MONITORS_PER_USER
};