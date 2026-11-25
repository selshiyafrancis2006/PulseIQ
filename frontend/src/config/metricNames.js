import SHARED_METRICS from '../../../shared/metrics.json'

export const METRICS = Object.freeze(
  Object.fromEntries(
    Object.entries(SHARED_METRICS).map(([key, metric]) => [
      key,
      Object.freeze({
        ...metric,
        label: metric.name,
        live: metric.capabilities.liveUpdates,
        axis: metric.unit === '%'
          ? 'y'
          : metric.unit === 'KB/s'
            ? 'yNetwork'
            : 'yOther'
      })
    ])
  )
)

export const METRIC_NAMES = Object.freeze(Object.keys(METRICS))

export const BUILT_IN_METRICS = Object.freeze(
  METRIC_NAMES.map(name => Object.freeze({
    ...METRICS[name],
    name,
    label: METRICS[name].name
  }))
)

export const METRIC_KEYS = METRIC_NAMES

export const METRIC_OPTIONS = Object.freeze(
  METRIC_NAMES
    .filter(name => METRICS[name].capabilities.query)
    .map(name => ({
      label: METRICS[name].name,
      value: name
    }))
)

export const DASHBOARD_METRIC_OPTIONS = Object.freeze(
  METRIC_NAMES
    .filter(name => METRICS[name].capabilities.dashboardWidgets)
    .map(name => ({
      label: METRICS[name].name,
      value: name
    }))
)

export const METRIC_COLORS = Object.freeze(
  Object.fromEntries(
    METRIC_NAMES.map(name => [name, METRICS[name].color])
  )
)

export const PERCENT_METRIC_KEYS = Object.freeze(
  METRIC_NAMES.filter(name => METRICS[name].unit === '%')
)

export const LIVE_METRIC_KEYS = Object.freeze(
  METRIC_NAMES.filter(name => METRICS[name].live)
)

export const getMetricAxisId = key => METRICS[key]?.axis ?? 'y'

