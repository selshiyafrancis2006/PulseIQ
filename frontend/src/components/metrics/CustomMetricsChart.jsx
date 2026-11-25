import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend
} from 'chart.js'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend
)

const SERIES_COLORS = [
  '#10b981',
  '#38bdf8',
  '#f59e0b',
  '#a78bfa',
  '#fb7185',
  '#f97316',
  '#a3e635',
  '#e879f9',
  '#22d3ee',
  '#facc15'
]

const normalizeTags = (tags) => {
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(tags).sort(([a], [b]) => a.localeCompare(b))
  )
}

const getSeriesKey = (row) =>
  JSON.stringify({
    unit: row.unit ?? '',
    tags: normalizeTags(row.tags)
  })

const getSeriesLabel = (unit, tags) => {
  const tagLabel = Object.entries(tags)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ')

  return [tagLabel, unit].filter(Boolean).join(' · ') || 'Custom metric'
}

export default function CustomMetricsChart({ metrics = [], metricName = '' }) {
  if (!metrics.length) return null

  const timestamps = [...new Set(
    metrics
      .map(row => row.timestamp)
      .filter(timestamp => Number.isFinite(Date.parse(timestamp)))
  )].sort((a, b) => Date.parse(a) - Date.parse(b))

  const labels = timestamps.map(timestamp =>
    new Date(timestamp).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  )

  const timestampIndexes = new Map(
    timestamps.map((timestamp, index) => [timestamp, index])
  )

  const grouped = new Map()

  metrics.forEach(row => {
    const index = timestampIndexes.get(row.timestamp)
    const value = Number(row.value)

    if (index === undefined || !Number.isFinite(value)) return

    const tags = normalizeTags(row.tags)
    const key = getSeriesKey({ ...row, tags })

    if (!grouped.has(key)) {
      grouped.set(key, {
        label: getSeriesLabel(row.unit, tags),
        unit: row.unit ?? '',
        values: Array(timestamps.length).fill(null)
      })
    }

    grouped.get(key).values[index] = value
  })

  const datasets = [...grouped.values()].map((series, index) => ({
    label: series.label,
    data: series.values,
    borderColor: SERIES_COLORS[index % SERIES_COLORS.length],
    backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] + '20',
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
    tension: 0.3,
    spanGaps: false,
    unit: series.unit
  }))

  const latestValues = datasets.map(dataset => {
    const value = [...dataset.data].reverse().find(item => item !== null)
    return `${dataset.label}: ${value === undefined ? 'no value' : `${value} ${dataset.unit}`.trim()}`
  })

  return (
    <section className="bg-[#0d0d0d] border border-emerald-500/20 rounded-xl p-4 sm:p-6 mb-8">
      <h2 className="text-lg font-semibold text-white mb-1">
        {metricName || 'Custom metric'}
      </h2>

      <p className="text-xs text-gray-500 mb-5">
        {metrics.length} observations across {datasets.length} dimension series
      </p>

      <div
        className="h-[280px] sm:h-[360px] lg:h-[420px]"
        role="img"
        aria-label={`${metricName} custom metrics chart. ${latestValues.join('; ')}`}
      >
        <Line
          data={{ labels, datasets }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: {
                display: true,
                labels: { color: '#ffffff' }
              },
              tooltip: {
                callbacks: {
                  label: context =>
                    `${context.dataset.label}: ${context.parsed.y} ${context.dataset.unit}`.trim()
                }
              }
            },
            scales: {
              x: {
                grid: { color: '#2a2a2a' },
                ticks: { color: '#777', maxRotation: 0 }
              },
              y: {
                grid: { color: '#2a2a2a' },
                ticks: { color: '#777' }
              }
            }
          }}
        />
      </div>
    </section>
  )
}
