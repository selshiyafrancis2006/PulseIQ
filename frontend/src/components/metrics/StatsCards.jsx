// null (not 0 or NaN) for a missing value
const toNumber = (value) => {

  if (value === null || value === undefined) return null

  const number = Number(value)

  return Number.isFinite(number) ? number : null

}

import { formatMetricValue } from '../../utils/metricFormatting'

export default function StatsCards({
  metrics,
  selectedMetric
}) {

  if (!metrics.length) return null

  // One entry per row. Rollup rows carry <metric>_min / <metric>_max and a
  // sample_count; raw rows don't, so their min/max is the value itself and
  // each counts once.
  const points = metrics
    .map(metric => {

      const average = toNumber(metric[selectedMetric])

      const samples = toNumber(metric.sample_count)

      return {
        average,
        minimum: toNumber(metric[`${selectedMetric}_min`]) ?? average,
        maximum: toNumber(metric[`${selectedMetric}_max`]) ?? average,
        weight: samples !== null && samples > 0 ? samples : 1
      }

    })
    .filter(point => point.average !== null)

  if (!points.length) return null

  const latest = points[points.length - 1].average

  // Weighted by sample count so a half-filled bucket doesn't skew the average
  const totalWeight = points.reduce(
    (sum, point) => sum + point.weight,
    0
  )

  const average =
    points.reduce(
      (sum, point) => sum + point.average * point.weight,
      0
    ) / totalWeight

  const maximum = points.reduce(
    (best, point) => Math.max(best, point.maximum),
    -Infinity
  )

  const minimum = points.reduce(
    (best, point) => Math.min(best, point.minimum),
    Infinity
  )

  const stats = [
    {
      label: 'Latest',
      value: latest
    },
    {
      label: 'Average',
      value: average
    },
    {
      label: 'Maximum',
      value: maximum
    },
    {
      label: 'Minimum',
      value: minimum
    }
  ]

  return (

    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">

      {stats.map((stat) => (

        <div
          key={stat.label}
          className="
            bg-[#1a1a1a]
            border
            border-[#2a2a2a]
            rounded-xl
            p-5
          "
        >

          <p className="text-xs uppercase tracking-widest text-gray-500 mb-2">
            {stat.label}
          </p>

          <h2 className="text-3xl font-bold text-emerald-400">
            {formatMetricValue(selectedMetric, stat.value)}
          </h2>

        </div>

      ))}

    </div>

  )

}
