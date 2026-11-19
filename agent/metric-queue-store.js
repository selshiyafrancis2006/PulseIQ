const fs = require('fs');
const path = require('path');

function isSample(item) {
    return (
        item !== null &&
        typeof item === 'object' &&
        typeof item.sample_id === 'string' &&
        typeof item.collected_at === 'string'
    );
}

// Keeps the delivery queue in a JSON file, so samples waiting to be sent
// survive an agent restart or crash.
//
// Writes go to a temporary file first and are then renamed over the real
// file, so a crash in the middle of a write cannot leave a half-written
// queue behind. Saving never throws: a full disk or a locked file must not
// stop the agent from collecting and sending metrics.
function createFileStore(filePath, { logger = console } = {}) {
    const tmpPath = `${filePath}.tmp`;
    let warnedAboutSave = false;

    return {
        filePath,

        load() {
            let raw;

            try {
                raw = fs.readFileSync(filePath, 'utf8');
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(
                        `[MetricQueue] Could not read ${filePath}: ${error.message}`
                    );
                }

                return [];
            }

            try {
                const parsed = JSON.parse(raw);

                if (!Array.isArray(parsed)) {
                    throw new Error('expected a JSON array');
                }

                return parsed.filter(isSample);
            } catch (error) {
                const aside = `${filePath}.corrupt`;

                logger.warn(
                    `[MetricQueue] ${filePath} is unreadable (${error.message}); moving it to ${aside} and starting with an empty queue`
                );

                try {
                    fs.renameSync(filePath, aside);
                } catch {
                    // Nothing more to do; the next save overwrites it.
                }

                return [];
            }
        },

        save(items) {
            try {
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                fs.writeFileSync(tmpPath, JSON.stringify(items));
                fs.renameSync(tmpPath, filePath);
                warnedAboutSave = false;
            } catch (error) {
                if (!warnedAboutSave) {
                    warnedAboutSave = true;
                    logger.warn(
                        `[MetricQueue] Could not save the queue to ${filePath}: ${error.message}. Samples are kept in memory only until this works again.`
                    );
                }
            }
        }
    };
}

module.exports = { createFileStore };