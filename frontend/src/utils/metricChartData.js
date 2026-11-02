const ROLLUP_INTERVALS = {
  '6h': 5 * 60 * 1000,
  '24h': 5 * 60 * 1000,
  '3d': 60 * 60 * 1000,
  '7d': 60 * 60 * 1000,
  '30d': 60 * 60 * 1000,
  '90d': 60 * 60 * 1000
}

export const getMetricTimestamp = (metric) =>
  new Date(metric.collected_at || metric.timestamp).getTime()

const inferInterval = (timestamps) => {
  const differences = timestamps
    .slice(1)
    .map((timestamp, index) => timestamp - timestamps[index])
    .filter((difference) => Number.isFinite(difference) && difference > 0)
    .sort((a, b) => a - b)

  if (!differences.length) return null

  // Use the lower median so a single missed sample does not inflate
  // the inferred normal collection interval.
  return differences[Math.floor((differences.length - 1) / 2)]
}

export const buildMetricChartPoints = (metrics, timeRange) => {
  const sorted = metrics
    .map((metric) => ({
      metric,
      timestamp: getMetricTimestamp(metric)
    }))
    .filter(({ timestamp }) => Number.isFinite(timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)

  if (sorted.length < 2) {
    return sorted.map(({ metric, timestamp }) => ({ metric, timestamp }))
  }

  const interval = ROLLUP_INTERVALS[timeRange] ||
    inferInterval(sorted.map(({ timestamp }) => timestamp))

  if (!interval || interval <= 0) {
    return sorted.map(({ metric, timestamp }) => ({ metric, timestamp }))
  }

  const points = []

  sorted.forEach((current, index) => {
    if (index > 0) {
      const previous = sorted[index - 1]
      const difference = current.timestamp - previous.timestamp
      const steps = Math.round(difference / interval)

      if (steps >= 2 && difference >= interval * 1.5) {
        for (let step = 1; step < steps; step += 1) {
          points.push({
            metric: null,
            timestamp: previous.timestamp + interval * step
          })
        }
      }
    }

    points.push(current)
  })

  return points
}