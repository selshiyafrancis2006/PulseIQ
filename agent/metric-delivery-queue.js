class MetricDeliveryQueue {
    constructor({
        send,
        maxSize = 100,
        maxAttempts = 5,
        baseDelayMs = 1000,
        maxDelayMs = 8000,
        sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        logger = console,
        store = null,
        maxAgeMs = null,
        now = () => Date.now()
    }) {
        if (typeof send !== 'function') {
            throw new TypeError('send must be a function');
        }

        this.send = send;
        this.maxSize = maxSize;
        this.maxAttempts = maxAttempts;
        this.baseDelayMs = baseDelayMs;
        this.maxDelayMs = maxDelayMs;
        this.sleep = sleep;
        this.logger = logger;

        this.items = [];
        this.processing = false;
        this.activePromise = null;

        // Total samples that were given up on (queue full, permanent
        // failure, or retries exhausted) since the agent started.
        this.dropped = 0;

        // Optional persistence: { load(), save(items) }. Samples saved by a
        // previous run are put back at the front of the queue. Samples older
        // than maxAgeMs are no longer useful and are discarded, and if more
        // than maxSize remain only the newest are kept.
        this.store = store;
        this.restored = 0;

        if (this.store) {
            const stored = this.store.load();
            const cutoff = maxAgeMs === null ? null : now() - maxAgeMs;

            const fresh = stored.filter((item) => {
                if (cutoff === null) return true;

                const collectedAt = Date.parse(item.collected_at);

                return Number.isFinite(collectedAt) && collectedAt >= cutoff;
            });

            this.items = fresh.slice(-this.maxSize);
            this.restored = this.items.length;

            const discarded = stored.length - this.items.length;

            if (discarded > 0) {
                this.logger.warn(
                    `[MetricQueue] Discarded ${discarded} saved sample(s) that were too old or over the queue limit`
                );
            }

            if (stored.length !== this.items.length) {
                this.persist();
            }
        }
    }

    persist() {
        if (this.store) {
            this.store.save(this.items);
        }
    }

    enqueue(payload) {
        if (this.items.length >= this.maxSize) {
            // Preserve the sample currently being delivered.
            const dropIndex = this.processing ? 1 : 0;

            if (dropIndex >= this.items.length) {
                this.dropped++;
                this.logger.warn(
                    `[MetricQueue] Queue full; incoming sample dropped (${this.dropped} dropped in total)`
                );
                return false;
            }

            const [dropped] = this.items.splice(dropIndex, 1);

            this.dropped++;
            this.logger.warn(
                `[MetricQueue] Queue full; oldest waiting sample dropped: ${dropped.sample_id} (${this.dropped} dropped in total)`
            );
        }

        this.items.push(payload);
        this.persist();
        this.start();
        return true;
    }

    isRetryable(error) {
        const status = error.response?.status;

        if (status === undefined) {
            return true;
        }

        return status === 408 || status === 429 || status >= 500;
    }

    start() {
        if (this.processing) {
            return this.activePromise;
        }

        this.processing = true;

        this.activePromise = this.drain().finally(() => {
            this.processing = false;
            this.activePromise = null;

            if (this.items.length > 0) {
                this.start();
            }
        });

        return this.activePromise;
    }

    async drain() {
        while (this.items.length > 0) {
            const item = this.items[0];
            let delivered = false;

            for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
                try {
                    await this.send(item);
                    delivered = true;
                    break;
                } catch (error) {
                    const retryable = this.isRetryable(error);

                    if (!retryable) {
                        this.logger.error(
                            `[MetricQueue] Permanent delivery failure (${error.response?.status || 'unknown'}); dropping sample ${item.sample_id}`
                        );
                        break;
                    }

                    if (attempt === this.maxAttempts) {
                        this.logger.error(
                            `[MetricQueue] Maximum attempts reached; dropping sample ${item.sample_id}`
                        );
                        break;
                    }

                    const delay = Math.min(
                        this.baseDelayMs * (2 ** (attempt - 1)),
                        this.maxDelayMs
                    );

                    this.logger.warn(
                        `[MetricQueue] Delivery attempt ${attempt} failed; retrying in ${delay}ms`
                    );

                    await this.sleep(delay);
                }
            }

            if (!delivered) {
                this.dropped++;
            }

            // Remove only the item that was being delivered.
            if (this.items[0] === item) {
                this.items.shift();
                this.persist();
            }
        }
    }

    async waitForIdle() {
        while (this.processing && this.activePromise) {
            await this.activePromise;
        }
    }

    // Waits for the queue to empty, but for at most timeoutMs. Used on
    // shutdown so a server that is down cannot keep the agent alive through
    // the whole retry schedule. Resolves to the number of samples left unsent.
    async flush(timeoutMs = 5000) {
        let timer;

        const timeout = new Promise((resolve) => {
            timer = setTimeout(resolve, timeoutMs);
        });

        try {
            await Promise.race([this.waitForIdle(), timeout]);
        } finally {
            clearTimeout(timer);
        }

        return this.items.length;
    }

    get size() {
        return this.items.length;
    }

    get droppedCount() {
        return this.dropped;
    }

    get restoredCount() {
        return this.restored;
    }
}

module.exports = { MetricDeliveryQueue };