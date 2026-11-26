'use strict';

/**
 * Buffers APM traces in memory and delivers them to PulseIQ in batches.
 *
 * Design goals:
 *  - Never slow down or break the host application: add() is synchronous and
 *    cheap, delivery happens on an unref'd timer.
 *  - Stay well inside the backend's per-key rate limit. Delivery is paced by
 *    flushIntervalMs and capped at maxBatchesPerFlush requests per flush, no
 *    matter how much traffic the app serves.
 *  - Bounded memory: when the buffer is full the OLDEST traces are dropped.
 *  - Back off on 429 / 5xx / network errors (honouring Retry-After) and keep
 *    the batch for the next attempt; drop batches the server will never
 *    accept (other 4xx).
 *  - Never spam the host app's logs: each kind of warning is logged at most
 *    once per logIntervalMs, with a count of what was suppressed.
 */

function positiveInt(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

function isRetryable(status) {
    return (
        status === null ||
        status === 408 ||
        status === 429 ||
        status >= 500
    );
}

// Accepts delta-seconds ("120") or an HTTP date. Returns ms or null.
function parseRetryAfter(value, now) {
    if (value === undefined || value === null || value === '') return null;

    const text = String(value).trim();

    if (/^\d+$/.test(text)) {
        return Number(text) * 1000;
    }

    const date = Date.parse(text);

    return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function describeError(err, now) {
    const status = err?.response?.status ?? err?.status ?? null;
    const header =
        err?.response?.headers?.['retry-after'] ?? err?.retryAfter ?? null;

    return {
        status: Number.isInteger(status) ? status : null,
        retryAfterMs: parseRetryAfter(header, now),
        message: err?.message || String(err)
    };
}

class ApmReporter {
    /**
     * @param {object}   options
     * @param {Function} options.send  async (traces[]) => response body.
     *                                 Throw (axios-style) on failure.
     */
    constructor(options = {}) {
        if (typeof options.send !== 'function') {
            throw new TypeError('ApmReporter requires a send function');
        }

        this.send = options.send;
        this.flushIntervalMs = positiveInt(options.flushIntervalMs, 5000);
        this.maxBatchSize = positiveInt(options.maxBatchSize, 100);
        this.flushOnBatch = options.flushOnBatch === true;
        this.maxBatchesPerFlush = positiveInt(options.maxBatchesPerFlush, 2);
        this.maxBufferSize = Math.max(
            this.maxBatchSize,
            positiveInt(options.maxBufferSize, 1000)
        );
        this.baseBackoffMs = positiveInt(options.baseBackoffMs, 1000);
        this.maxBackoffMs = positiveInt(options.maxBackoffMs, 60000);
        this.logIntervalMs = positiveInt(options.logIntervalMs, 60000);

        this.now = options.now || Date.now;
        this.setTimer = options.setTimer || setTimeout;
        this.clearTimer = options.clearTimer || clearTimeout;
        this.logger = options.logger || console;

        this.buffer = [];
        this.timer = null;
        this.flushing = null;
        this.closed = false;

        this.failures = 0;
        this.retryAt = 0;

        this.stats = { sent: 0, dropped: 0, rejected: 0 };
        this.lastLog = new Map();
    }

    get size() {
        return this.buffer.length;
    }

    add(trace) {
        if (this.closed) return;

        this.buffer.push(trace);
        this.trim();

        if (this.flushOnBatch && this.buffer.length >= this.maxBatchSize) {
            this.flush().catch(() => {});
        } else {
            this.schedule(this.flushIntervalMs);
        }
    }

    // Drop the oldest traces when over capacity.
    trim() {
        const excess = this.buffer.length - this.maxBufferSize;

        if (excess <= 0) return;

        this.buffer.splice(0, excess);
        this.stats.dropped += excess;

        this.warn(
            'overflow',
            `trace buffer is full; dropped ${excess} oldest trace(s). ` +
            'Lower the traffic with the sampleRate option if this persists.'
        );
    }

    schedule(delayMs) {
        if (this.timer || this.closed) return;

        // Never wake up before a backoff window ends.
        const delay = Math.max(delayMs, this.retryAt - this.now());

        this.timer = this.setTimer(() => {
            this.timer = null;
            this.flush().catch(() => {});
        }, delay);

        if (this.timer && typeof this.timer.unref === 'function') {
            this.timer.unref();
        }
    }

    /**
     * Sends buffered traces. Normally at most maxBatchesPerFlush requests;
     * with { force: true } it drains everything and ignores backoff (used on
     * shutdown and for manual flushes).
     */
    flush({ force = false } = {}) {
        if (this.flushing) return this.flushing;

        this.flushing = this.runFlush(force).finally(() => {
            this.flushing = null;

            if (this.buffer.length > 0) {
                this.schedule(this.flushIntervalMs);
            }
        });

        return this.flushing;
    }

    async runFlush(force) {
        if (!force && this.now() < this.retryAt) return;

        let requests = 0;

        while (
            this.buffer.length > 0 &&
            (force || requests < this.maxBatchesPerFlush)
        ) {
            // Take the batch out first so traces added while the request is
            // in flight cannot be confused with it.
            const batch = this.buffer.splice(0, this.maxBatchSize);
            requests++;

            try {
                const result = await this.send(batch);

                this.failures = 0;
                this.retryAt = 0;

                const rejected = Number(result?.rejected) || 0;

                this.stats.sent += Math.max(0, batch.length - rejected);
                this.stats.rejected += rejected;

                if (rejected > 0) {
                    const first = result?.errors?.[0]?.error;

                    this.warn(
                        'rejected',
                        `server rejected ${rejected} of ${batch.length} ` +
                        `trace(s)${first ? ` (e.g. ${first})` : ''}`
                    );
                }
            } catch (err) {
                const { status, retryAfterMs, message } =
                    describeError(err, this.now());

                if (!isRetryable(status)) {
                    this.stats.dropped += batch.length;

                    this.warn(
                        'dropped',
                        `dropped ${batch.length} trace(s): server answered ` +
                        `${status} (${message})`
                    );

                    continue;
                }

                // Keep the batch (oldest first) and wait before retrying.
                this.buffer.unshift(...batch);
                this.trim();

                this.failures++;

                const backoff = Math.min(
                    this.maxBackoffMs,
                    this.baseBackoffMs * 2 ** (this.failures - 1)
                );

                const wait = Math.min(
                    this.maxBackoffMs,
                    retryAfterMs !== null ? retryAfterMs : backoff
                );

                this.retryAt = this.now() + wait;

                this.warn(
                    'send-failed',
                    `could not deliver traces (${status ?? 'network'}: ` +
                    `${message}); retrying in ${Math.ceil(wait / 1000)}s`
                );

                return;
            }
        }
    }

    /**
     * Stops accepting traces and makes one last attempt to deliver what is
     * buffered, giving up after timeoutMs so it can never hang an exit.
     */
    async shutdown(timeoutMs = 2000) {
        if (this.closed) return;

        this.closed = true;

        if (this.timer) {
            this.clearTimer(this.timer);
            this.timer = null;
        }

        let deadline;

        // Deliberately NOT unref'd: shutdown is explicit and bounded by
        // timeoutMs, and the promise must settle even if nothing else keeps
        // the event loop alive.
        const timeout = new Promise((resolve) => {
            deadline = setTimeout(resolve, timeoutMs);
        });

        const drain = (async () => {
            if (this.flushing) {
                await this.flushing.catch(() => {});
            }

            await this.flush({ force: true });
        })().catch(() => {});

        try {
            await Promise.race([drain, timeout]);
        } finally {
            clearTimeout(deadline);
        }
    }

    // At most one log line per key per logIntervalMs.
    warn(key, message) {
        const now = this.now();
        const entry = this.lastLog.get(key) || { at: -Infinity, suppressed: 0 };

        if (now - entry.at < this.logIntervalMs) {
            entry.suppressed++;
            this.lastLog.set(key, entry);
            return;
        }

        const suffix = entry.suppressed
            ? ` (${entry.suppressed} similar message(s) suppressed)`
            : '';

        this.lastLog.set(key, { at: now, suppressed: 0 });
        this.logger.warn(`[pulseiq-apm] ${message}${suffix}`);
    }
}

module.exports = {
    ApmReporter,
    isRetryable,
    parseRetryAfter
};
