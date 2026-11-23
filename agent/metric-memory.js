function getMemoryUsagePercent(mem, platform = process.platform) {
    if (!mem || !Number.isFinite(mem.total) || mem.total <= 0) {
        return 0;
    }

    const used = platform === 'linux'
        ? mem.total - mem.available
        : mem.used;

    if (!Number.isFinite(used)) {
        return 0;
    }

    const percentage = (used / mem.total) * 100;

    return Number(Math.min(100, Math.max(0, percentage)).toFixed(2));
}

module.exports = { getMemoryUsagePercent };
