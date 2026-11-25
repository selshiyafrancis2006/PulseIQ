// Single source of truth for the host metrics the backend knows about.
// Add a metric here (plus its DB columns and the agent) and ingestion
// validation, queries, rollups-based baselines and alert severity pick it up.

const METRIC_DEFINITIONS = {
    cpu_usage:    { label: 'CPU Usage',         unit: '%',    percent: true,  required: true },
    memory_usage: { label: 'Memory Usage',      unit: '%',    percent: true,  required: true },
    disk_usage:   { label: 'Disk Usage',        unit: '%',    percent: true,  required: true },
    network_in:   { label: 'Network In',        unit: 'KB/s', percent: false, required: true },
    network_out:  { label: 'Network Out',       unit: 'KB/s', percent: false, required: true },
    // Optional: agents older than this release do not send them.
    load_avg:     { label: 'Load Average (1m)', unit: '',     percent: false, required: false },
    swap_usage:   { label: 'Swap Usage',        unit: '%',    percent: true,  required: false }
};

const METRIC_NAMES = Object.freeze(Object.keys(METRIC_DEFINITIONS));

const pick = (predicate) => Object.freeze(
    METRIC_NAMES.filter((name) => predicate(METRIC_DEFINITIONS[name]))
);

const REQUIRED_METRICS = pick((metric) => metric.required);
const OPTIONAL_METRICS = pick((metric) => !metric.required);
const PERCENT_METRICS = pick((metric) => metric.percent);

module.exports = {
    METRIC_DEFINITIONS,
    METRIC_NAMES,
    REQUIRED_METRICS,
    OPTIONAL_METRICS,
    PERCENT_METRICS
};
