// Ranges the APM API accepts (see backend/src/utils/apmRange.js) and how
// often each is worth refreshing: a 7-day series is expensive to compute
// and barely changes in 5 seconds.
export const APM_RANGES = [
  { value: '15m', label: '15m', description: 'the last 15 minutes', refreshMs: 5000 },
  { value: '1h', label: '1h', description: 'the last hour', refreshMs: 5000 },
  { value: '6h', label: '6h', description: 'the last 6 hours', refreshMs: 15000 },
  { value: '24h', label: '24h', description: 'the last 24 hours', refreshMs: 30000 },
  { value: '7d', label: '7d', description: 'the last 7 days', refreshMs: 60000 }
]

export const DEFAULT_APM_RANGE = '1h'

export const getApmRange = (value) =>
  APM_RANGES.find((range) => range.value === value) ||
  APM_RANGES.find((range) => range.value === DEFAULT_APM_RANGE)

const isMissing = (value) =>
  value === null || value === undefined || Number.isNaN(Number(value))

// null (no requests, so no latency) renders as a dash, never as "0 ms"
export const formatMs = (value) =>
  isMissing(value)
    ? 'â€”'
    : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })} ms`

export const formatPercent = (value) =>
  isMissing(value)
    ? 'â€”'
    : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`

export const formatThroughput = (value) =>
  isMissing(value)
    ? 'â€”'
    : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })} req/min`

// Day-or-longer ranges need the date too, or labels repeat ambiguously
export const formatBucketLabel = (timestamp, rangeValue) => {
  const date = new Date(timestamp)

  if (rangeValue === '24h' || rangeValue === '7d') {
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    ...(rangeValue === '15m' ? { second: '2-digit' } : {})
  })
}

// null (not 0 or NaN) for a missing value, so a chart shows a gap
export const toChartNumber = (value) =>
  isMissing(value) ? null : Number(value)

export const statusColor = (status) => {
  if (status >= 500) return 'text-red-400'
  if (status >= 400) return 'text-yellow-400'
  return 'text-emerald-400'
}