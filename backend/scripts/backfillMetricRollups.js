function parseArguments(args) {
    const options = {};

    for (let i = 0; i < args.length; i += 2) {
        const key = args[i];

        if (!key.startsWith('--') || !args[i + 1]) {
            throw new Error('Arguments must use --from, --to, and --tier followed by values.');
        }

        if (Object.prototype.hasOwnProperty.call(options, key)) {
            throw new Error(`Duplicate argument: ${key}`);
        }

        options[key] = args[i + 1];
    }

    const allowed = ['--from', '--to', '--tier'];

    for (const key of Object.keys(options)) {
        if (!allowed.includes(key)) {
            throw new Error(`Unknown argument: ${key}`);
        }
    }

    for (const key of allowed) {
        if (!options[key]) {
            throw new Error(`Missing required argument: ${key}`);
        }
    }

    return options;
}

function parseUtcDate(value, label) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
        throw new Error(`${label} must use UTC ISO format: YYYY-MM-DDTHH:mm:ss.sssZ`);
    }

    const date = new Date(value);

    if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
        throw new Error(`${label} is not a valid UTC date`);
    }

    return date;
}

async function main() {
    const options = parseArguments(process.argv.slice(2));

    const from = parseUtcDate(options['--from'], '--from');
    const to = parseUtcDate(options['--to'], '--to');
    const tier = options['--tier'];

    if (!['5m', '1h', 'both'].includes(tier)) {
        throw new Error('--tier must be 5m, 1h, or both');
    }

    if (from >= to) {
        throw new Error('--from must be earlier than --to');
    }

    if (tier === 'both') {
        const hourMs = 60 * 60 * 1000;

        if (from.getTime() % hourMs !== 0 || to.getTime() % hourMs !== 0) {
            throw new Error('--tier both requires whole-hour UTC boundaries');
        }
    }

    console.log('Metric rollup backfill requested:');
    console.log(`From: ${from.toISOString()}`);
    console.log(`To:   ${to.toISOString()}`);
    console.log(`Tier: ${tier}`);

    let pool;

    try {
        pool = require('../src/config/db');

        const {
            withMetricRollupLock,
            rollup5Minute,
            rollup1Hour
        } = require('../src/services/metricRollup.service');

        await withMetricRollupLock(async (client) => {
            const range = {
                from: from.toISOString(),
                to: to.toISOString()
            };

            if (tier === '5m' || tier === 'both') {
                console.log('Starting 5-minute backfill...');
                await rollup5Minute(client, range);
                console.log('5-minute backfill completed.');
            }

            if (tier === '1h' || tier === 'both') {
                console.log('Starting hourly backfill...');
                await rollup1Hour(client, range);
                console.log('Hourly backfill completed.');
            }
        });

        console.log('Metric rollup backfill completed successfully.');
    } finally {
        if (pool) {
            await pool.end();
        }
    }
}

main().catch((error) => {
    console.error('Metric rollup backfill failed:', error.message);
    process.exitCode = 1;
});
