import { METRICS } from '../config/metricNames'

export function getMetricUnit(metricName) {
  return METRICS[metricName]?.unit ?? ''
}

export function formatMetricValue(metricName, value) {
  if (value === null || value === undefined || value === '') {
    return 'â€”'
  }

  const number = Number(value)

  if (!Number.isFinite(number)) {
    return 'â€”'
  }

  if (metricName === 'network_in' || metricName === 'network_out') {
    return `${number.toFixed(1)} KB/s`
  }

  const unit = getMetricUnit(metricName)
  const formatted = number.toFixed(2)

  if (unit === '%') return `${formatted}%`

  return unit ? `${formatted} ${unit}` : formatted
}

export function formatMetricColumnHeader(columnName) {
  const metricName = columnName.replace(/_(min|max)$/, '')
  const unit = getMetricUnit(metricName)

  return unit ? `${columnName} (${unit})` : columnName
}

