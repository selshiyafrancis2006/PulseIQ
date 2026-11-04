import { METRICS } from '../config/metricNames'
import { formatRate } from './hostStatus'

export function getMetricUnit(metricName) {
  return METRICS[metricName]?.unit ?? ''
}

export function formatMetricValue(metricName, value) {
  if (value === null || value === undefined || value === '') {
    return '—'
  }

  const number = Number(value)

  if (!Number.isFinite(number)) {
    return '—'
  }

  if (metricName === 'network_in' || metricName === 'network_out') {
    return formatRate(number)
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

