const test = require('node:test');
const assert = require('node:assert/strict');

const { pickSystemDisk, pickNetworkStats } = require('./metric-selection');

test('prefers the root mount on Linux over a larger data disk', () => {
    const disk = pickSystemDisk(
        [
            { mount: '/boot/efi', size: 500, use: 5 },
            { mount: '/data', size: 9000, use: 80 },
            { mount: '/', size: 1000, use: 42 }
        ],
        { platform: 'linux' }
    );

    assert.equal(disk.mount, '/');
});

test('prefers the system drive on Windows', () => {
    const disk = pickSystemDisk(
        [
            { mount: 'D:', size: 9000, use: 10 },
            { mount: 'C:', size: 1000, use: 60 }
        ],
        { platform: 'win32', systemDrive: 'C:' }
    );

    assert.equal(disk.mount, 'C:');
});

test('falls back to the largest disk when the system mount is missing', () => {
    const disk = pickSystemDisk(
        [
            { mount: '/a', size: 100, use: 1 },
            { mount: '/b', size: 900, use: 2 }
        ],
        { platform: 'linux' }
    );

    assert.equal(disk.mount, '/b');
});

test('ignores empty or malformed disks and returns null when none are usable', () => {
    assert.equal(pickSystemDisk([], { platform: 'linux' }), null);
    assert.equal(pickSystemDisk(undefined, { platform: 'linux' }), null);
    assert.equal(
        pickSystemDisk(
            [{ mount: '/', size: 0, use: 0 }, { mount: '/x', size: 10, use: NaN }, null],
            { platform: 'linux' }
        ),
        null
    );
});

test('uses the default-route interface when it has stats', () => {
    const stats = pickNetworkStats(
        [
            { iface: 'docker0', operstate: 'up', rx_bytes: 999999, tx_bytes: 1 },
            { iface: 'eth0', operstate: 'up', rx_bytes: 10, tx_bytes: 10 }
        ],
        'eth0'
    );

    assert.equal(stats.iface, 'eth0');
});

test('without a default, picks the busiest connected non-loopback interface', () => {
    const stats = pickNetworkStats([
        { iface: 'lo', operstate: 'unknown', rx_bytes: 5000000, tx_bytes: 5000000 },
        { iface: 'wlan0', operstate: 'down', rx_bytes: 9000000, tx_bytes: 0 },
        { iface: 'eth0', operstate: 'up', rx_bytes: 100, tx_bytes: 50 },
        { iface: 'eth1', operstate: 'up', rx_bytes: 900, tx_bytes: 50 }
    ]);

    assert.equal(stats.iface, 'eth1');
});

test('falls back to any non-loopback interface when none are up', () => {
    const stats = pickNetworkStats([
        { iface: 'Loopback Pseudo-Interface 1', operstate: 'up', rx_bytes: 9, tx_bytes: 9 },
        { iface: 'Ethernet', operstate: 'down', rx_bytes: 1, tx_bytes: 1 }
    ]);

    assert.equal(stats.iface, 'Ethernet');
});

test('returns null when there is nothing but loopback or bad data', () => {
    assert.equal(pickNetworkStats([]), null);
    assert.equal(pickNetworkStats(null), null);
    assert.equal(pickNetworkStats([{ iface: 'lo' }, { rx_bytes: 1 }]), null);
});