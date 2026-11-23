// Collects the busiest processes of this host and sends them to PulseIQ.
//
// A snapshot is "what is running right now", so it is not queued or retried:
// the next snapshot replaces it. A failed send is logged once and the agent
// carries on, so process reporting can never get in the way of metrics.

const DEFAULT_PER_SORT = 15;

function toNumber(value) {
    const number = Number(value);

    return Number.isFinite(number) && number >= 0 ? number : 0;
}

// Takes the busiest processes by CPU and by memory (so a quiet but huge
// process still shows up), without duplicates. Memory is sent in MB;
// systeminformation reports memRss in KB.
function summarizeProcesses(list, { perSort = DEFAULT_PER_SORT } = {}) {
    const processes = (Array.isArray(list) ? list : []).filter(
        (entry) =>
            entry &&
            typeof entry === 'object' &&
            Number.isSafeInteger(entry.pid) &&
            typeof entry.name === 'string' &&
            entry.name.trim() !== ''
    );

    const byCpu = [...processes].sort((a, b) => toNumber(b.cpu) - toNumber(a.cpu));
    const byMemory = [...processes].sort((a, b) => toNumber(b.memRss) - toNumber(a.memRss));

    const chosen = new Map();

    for (const entry of [...byCpu.slice(0, perSort), ...byMemory.slice(0, perSort)]) {
        if (!chosen.has(entry.pid)) {
            chosen.set(entry.pid, {
                pid: entry.pid,
                name: entry.name.trim(),
                cpu: Number(toNumber(entry.cpu).toFixed(2)),
                memory_mb: Math.round(toNumber(entry.memRss) / 1024)
            });
        }
    }

    return [...chosen.values()];
}

function createProcessReporter({
    listProcesses,
    send,
    intervalMs,
    logger = console,
    now = () => new Date()
}) {
    let timer = null;
    let running = false;
    let warned = false;

    async function tick() {
        if (running) return false;

        running = true;

        try {
            const list = await listProcesses();
            const processes = summarizeProcesses(list);

            await send({
                collected_at: now().toISOString(),
                processes
            });

            warned = false;

            return true;
        } catch (error) {
            if (!warned) {
                warned = true;
                logger.warn(
                    `[PulseIQ Agent] Could not send the process list: ${error.message}. Will keep trying every ${Math.round(intervalMs / 1000)}s.`
                );
            }

            return false;
        } finally {
            running = false;
        }
    }

    return {
        tick,

        start() {
            if (timer) return;

            tick();
            timer = setInterval(tick, intervalMs);
        },

        stop() {
            clearInterval(timer);
            timer = null;
        }
    };
}

module.exports = { summarizeProcesses, createProcessReporter };