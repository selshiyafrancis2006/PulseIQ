// Chooses which disk and which network interface represent the host.
//
// systeminformation lists every mount and every adapter. Taking the first one
// can report a small boot partition, a virtual adapter, or loopback instead of
// the disk and the connection people actually mean.

const LOOPBACK = /^(lo\d*|loopback.*)$/i;

function toNumber(value) {
    const number = Number(value);

    return Number.isFinite(number) ? number : 0;
}

function isUsableDisk(entry) {
    return (
        entry !== null &&
        typeof entry === 'object' &&
        Number.isFinite(Number(entry.use)) &&
        toNumber(entry.size) > 0
    );
}

// Prefers the system disk ("/" on Linux and macOS, the system drive on
// Windows), then the largest disk. Returns null when nothing is usable.
function pickSystemDisk(
    fsList,
    { platform = process.platform, systemDrive = process.env.SystemDrive } = {}
) {
    const disks = (Array.isArray(fsList) ? fsList : []).filter(isUsableDisk);

    if (disks.length === 0) return null;

    const systemMount = platform === 'win32'
        ? String(systemDrive || 'C:').toUpperCase()
        : '/';

    const system = disks.find((disk) => {
        const mount = String(disk.mount ?? '');

        return platform === 'win32'
            ? mount.toUpperCase().startsWith(systemMount)
            : mount === systemMount;
    });

    if (system) return system;

    return disks.reduce((largest, disk) =>
        toNumber(disk.size) > toNumber(largest.size) ? disk : largest
    );
}

// Prefers the default-route interface, then the busiest connected
// non-loopback interface, then the first non-loopback one.
function pickNetworkStats(statsList, defaultIface = null) {
    const stats = (Array.isArray(statsList) ? statsList : []).filter(
        (entry) =>
            entry !== null &&
            typeof entry === 'object' &&
            typeof entry.iface === 'string' &&
            !LOOPBACK.test(entry.iface)
    );

    if (stats.length === 0) return null;

    if (defaultIface) {
        const wanted = stats.find((entry) => entry.iface === defaultIface);

        if (wanted) return wanted;
    }

    const connected = stats.filter(
        (entry) => String(entry.operstate).toLowerCase() === 'up'
    );
    const candidates = connected.length > 0 ? connected : stats;

    return candidates.reduce((busiest, entry) => {
        const traffic = (e) => toNumber(e.rx_bytes) + toNumber(e.tx_bytes);

        return traffic(entry) > traffic(busiest) ? entry : busiest;
    });
}


// Returns every usable disk for dimension-level collection.
function listUsableDisks(fsList) {
    return (Array.isArray(fsList) ? fsList : []).filter(isUsableDisk);
}

// Returns every usable non-loopback interface for dimension-level collection.
function listUsableNetworkStats(statsList) {
    return (Array.isArray(statsList) ? statsList : []).filter(
        (entry) =>
            entry !== null &&
            typeof entry === 'object' &&
            typeof entry.iface === 'string' &&
            entry.iface.trim().length > 0 &&
            !LOOPBACK.test(entry.iface)
    );
}

module.exports = { pickSystemDisk, pickNetworkStats, listUsableDisks, listUsableNetworkStats };

