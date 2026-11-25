const fs = require('fs');
const path = require('path');
const { METRIC_NAMES } = require('../src/config/metricRegistry');

const readRepoFile = (...parts) =>
    fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');

// The agent ships on its own and cannot import shared/metrics.json, so this
// test is what keeps its payload in step with the registry.
describe('registry consumers that cannot import it', () => {
    test('the agent collector reports every registry metric', () => {
        const source = readRepoFile('agent', 'collector.js');

        for (const name of METRIC_NAMES) {
            expect(source).toMatch(new RegExp(`\\b${name}\\b`));
        }
    });

    test('the host detail endpoint returns every registry metric', () => {
        const source = readRepoFile('backend', 'src', 'routes', 'hosts.routes.js');

        expect(source).toContain('METRIC_NAMES');
    });
});