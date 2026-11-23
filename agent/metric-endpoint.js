function getMetricsEndpoint(payload, config) {
    return Array.isArray(payload.metrics)
        ? config.customMetricsUrl
        : config.metricsUrl;
}

module.exports = { getMetricsEndpoint };
