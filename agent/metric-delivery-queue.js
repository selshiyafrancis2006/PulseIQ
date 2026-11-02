class MetricDeliveryQueue {
    constructor({
        send,
        maxSize = 100,
        maxAttempts = 5,
        baseDelayMs = 1000,
        maxDelayMs = 8000,
        sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        logger = console
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
    }

    enqueue(payload) {
        if (this.items.length >= this.maxSize) {
            // Preserve the sample currently being delivered.
            const dropIndex = this.processing ? 1 : 0;

            if (dropIndex >= this.items.length) {
                this.logger.warn(
                    '[MetricQueue] Queue full; incoming sample dropped'
                );
                return false;
            }

            const [dropped] = this.items.splice(dropIndex, 1);

            this.logger.warn(
                `[MetricQueue] Queue full; oldest waiting sample dropped: ${dropped.sample_id}`
            );
        }

        this.items.push(payload);
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

            // Remove only the item that was being delivered.
            if (this.items[0] === item) {
                this.items.shift();
            }

            if (!delivered) {
                continue;
            }
        }
    }

    async waitForIdle() {
        while (this.processing && this.activePromise) {
            await this.activePromise;
        }
    }

    get size() {
        return this.items.length;
    }
}

module.exports = { MetricDeliveryQueue };
