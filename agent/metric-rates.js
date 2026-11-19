// Converts a bytes-per-second reading from systeminformation into KB/s.
//
// systeminformation reports `null` for a rate it cannot compute yet (the very
// first reading, or an interface that just reset its counters). The backend
// only accepts finite, non-negative numbers, so anything else becomes 0
// instead of producing a request the server would reject.
function toRateKBps(bytesPerSecond) {
    const value = Number(bytesPerSecond);

    if (
        bytesPerSecond === null ||
        bytesPerSecond === undefined ||
        !Number.isFinite(value) ||
        value < 0
    ) {
        return 0;
    }

    return Number((value / 1024).toFixed(2));
}

module.exports = { toRateKBps };