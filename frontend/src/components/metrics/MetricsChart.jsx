import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
  Legend
} from 'chart.js'
import {
  buildMetricChartPoints,
  buildHostMetricChartPoints
} from '../../utils/metricChartData'
import { formatMetricValue } from '../../utils/metricFormatting'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
  Legend
)

const metricColors = {
  cpu_usage: '#10b981',
  memory_usage: '#38bdf8',
  disk_usage: '#f59e0b',
  network_in: '#a78bfa',
  network_out: '#fb7185'
}

// Window and label for every range the UI offers
const RANGES = {
  '1m': { minutes: 1, label: '1 minute' },
  '5m': { minutes: 5, label: '5 minutes' },
  '15m': { minutes: 15, label: '15 minutes' },
  '1h': { minutes: 60, label: '1 hour' },
  '6h': { minutes: 360, label: '6 hours' },
  '24h': { minutes: 1440, label: '24 hours' },
  '3d': { minutes: 4320, label: '3 days' },
  '7d': { minutes: 10080, label: '7 days' },
  '30d': { minutes: 43200, label: '30 days' },
  '90d': { minutes: 129600, label: '90 days' }
}

// null (not 0 or NaN) for a missing value, so the chart shows a gap
const toNumber = (value) => {
  const number = Number.parseFloat(value)

  return Number.isFinite(number) ? number : null
}

export default function MetricsChart({
  metrics,
  selectedMetrics,
  timeRange,
  primaryHostId = null,
  hosts = [],
  comparisonHostIds = []
}) {

  if (!metrics.length) return null

  const range = RANGES[timeRange]
  const comparisonMode =
    primaryHostId !== null &&
    comparisonHostIds.length > 0

  const selectedHosts = comparisonMode
    ? [
        ...new Map(
          [primaryHostId, ...comparisonHostIds]
            .map(id => String(id))
            .map(id => [id, hosts.find(host => String(host.id) === id)])
            .filter(([, host]) => Boolean(host))
        ).values()
      ]
    : []

  // Preserve the original single-host chart path.
  const hostChart = comparisonMode
    ? buildHostMetricChartPoints(metrics, timeRange)
    : null

  const chartPoints = comparisonMode
    ? hostChart.timestamps.map(timestamp => ({
        timestamp,
        metric: null
      }))
    : buildMetricChartPoints(metrics, timeRange)

  // Day-or-longer ranges need the date too, or labels repeat ambiguously
  const formatLabel = (timestamp) => {
    const date = new Date(timestamp)

    return range && range.minutes >= 1440
      ? date.toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      : date.toLocaleTimeString()
  }

  const labels = chartPoints.map(point =>
    formatLabel(point.timestamp)
  )

  // Min-max shading remains available in single-host mode.
  const bandMetric =
    !comparisonMode && selectedMetrics.length === 1
      ? selectedMetrics[0]
      : null

  const showBand =
    bandMetric !== null &&
    chartPoints.some(point =>
      point.metric &&
      toNumber(point.metric[`${bandMetric}_max`]) !== null
    )

  const datasets = comparisonMode
    ? (() => {
        const hostSeriesById = new Map(
          hostChart.hosts.map(host => [host.hostId, host])
        )

        const hostColors = [
          '#10b981',
          '#38bdf8',
          '#f59e0b',
          '#a78bfa',
          '#fb7185',
          '#f97316',
          '#a3e635',
          '#e879f9'
        ]

        const metricDashPatterns = [
          [],
          [6, 3],
          [2, 3],
          [8, 3, 2, 3],
          [10, 4]
        ]

        return selectedHosts.flatMap((host, hostIndex) => {
          const hostId = String(host.id)
          const hostSeries = hostSeriesById.get(hostId)

          if (!hostSeries) return []

          return selectedMetrics.map((metric, metricIndex) => {
            const name = metric
              .replace('_', ' ')
              .toUpperCase()

            const color = hostColors[hostIndex % hostColors.length]

            return {
              label: `${host.name} · ${name}`,
              metricKey: metric,
              hostId,
              yAxisID: metric.startsWith('network_') ? 'yNetwork' : 'y',
              data: hostSeries.points.map(point =>
                point.metric ? toNumber(point.metric[metric]) : null
              ),
              borderColor: color,
              backgroundColor: color + '20',
              borderWidth: 2,
              borderDash: metricDashPatterns[
                metricIndex % metricDashPatterns.length
              ],
              fill: false,
              pointRadius: 0,
              pointHoverRadius: 4,
              spanGaps: false,
              tension: 0.35,
              order: 0
            }
          })
        })
      })()
    : (() => {
        const singleHostDatasets = selectedMetrics.map(metric => {
          const name = metric
            .replace('_', ' ')
            .toUpperCase()

          return {
            label: showBand ? `${name} (AVG)` : name,
            metricKey: metric,
            yAxisID: metric.startsWith('network_') ? 'yNetwork' : 'y',
            data: chartPoints.map(point =>
              point.metric ? toNumber(point.metric[metric]) : null
            ),
            borderColor: metricColors[metric],
            backgroundColor: metricColors[metric] + '20',
            borderWidth: 2,
            fill: false,
            pointRadius: 0,
            pointHoverRadius: 4,
            spanGaps: false,
            tension: 0.35,
            order: 0
          }
        })

        if (showBand) {
          const color = metricColors[bandMetric]

          singleHostDatasets.push({
            label: 'Max',
            metricKey: bandMetric,
            yAxisID: bandMetric.startsWith('network_') ? 'yNetwork' : 'y',
            data: chartPoints.map(point =>
              point.metric ? toNumber(point.metric[`${bandMetric}_max`]) : null
            ),
            borderColor: 'transparent',
            backgroundColor: 'transparent',
            borderWidth: 0,
            fill: false,
            pointRadius: 0,
            pointHoverRadius: 0,
            spanGaps: false,
            tension: 0.35,
            order: 1
          })

          singleHostDatasets.push({
            label: 'Min',
            metricKey: bandMetric,
            yAxisID: bandMetric.startsWith('network_') ? 'yNetwork' : 'y',
            data: chartPoints.map(point =>
              point.metric ? toNumber(point.metric[`${bandMetric}_min`]) : null
            ),
            borderColor: 'transparent',
            backgroundColor: color + '26',
            borderWidth: 0,
            fill: '-1',
            pointRadius: 0,
            pointHoverRadius: 0,
            spanGaps: false,
            tension: 0.35,
            order: 1
          })
        }

        return singleHostDatasets
      })()
  const latestValues = comparisonMode
    ? datasets.map(dataset => {
        const latestValue = [...dataset.data]
          .reverse()
          .find(value => value !== null)

        return latestValue === undefined
          ? `${dataset.label}: no recorded value`
          : `${dataset.label}: ${formatMetricValue(dataset.metricKey, latestValue)}`
      })
    : selectedMetrics.map(metric => {
        const values = datasets.find(dataset => dataset.metricKey === metric)?.data ?? []
        const latestValue = [...values].reverse().find(value => value !== null)
        const name = metric.replace('_', ' ').replace(/\b\w/g, char => char.toUpperCase())

        return latestValue === undefined
          ? `${name}: no recorded value`
          : `${name}: ${formatMetricValue(metric, latestValue)}`
      })

  const chartDescription =
    `Metrics chart showing ${comparisonMode
      ? selectedHosts.map(host => host.name).join(', ')
      : selectedMetrics.map(metric =>
          metric.replace('_', ' ').replace(/\b\w/g, char => char.toUpperCase())
        ).join(', ')} over the last ${range ? range.label : timeRange}. ` +
    `${metrics.length} recorded ${metrics.length === 1 ? 'sample' : 'samples'}. Latest values: ${latestValues.join('; ')}.`
  const data = {

    labels,

    datasets

  }

  const options = {

    responsive: true,

    maintainAspectRatio: false,

    animation: false,

    // With a band, hovering shows average, max and min together
    interaction: showBand || comparisonMode
      ? { mode: 'index', intersect: false }
      : undefined,

    plugins: {

      legend: {
        display: true,
        labels: {
          color: '#ffffff',
          // The band datasets are explained in the subtitle, not the legend
          filter: (item) => item.text !== 'Max' && item.text !== 'Min'
        }
      },

      tooltip: {
        callbacks: {
          label: (context) => {
            const metricKey = context.dataset.metricKey
            const value = metricKey
              ? formatMetricValue(metricKey, context.parsed.y)
              : context.formattedValue

            return `${context.dataset.label}: ${value}`
          }
        }
      }

    },

    scales: {

      x: {

        grid: {
          color: '#2a2a2a'
        },

        ticks: {
          color: '#777'
        }

      },

      y: {

        beginAtZero: true,

        grid: {
          color: '#2a2a2a'
        },

        ticks: {
          color: '#777',
          callback: (value) => formatMetricValue('cpu_usage', value),
        }

      },

      yNetwork: {
        position: 'right',
        beginAtZero: true,
        grid: {
          drawOnChartArea: false
        },
        ticks: {
          color: '#777',
          callback: (value) => formatMetricValue('network_in', value),
        }
      }

    }

  }

  return (

    <div className="bg-[#0d0d0d] border border-emerald-500/20 rounded-xl p-4 sm:p-6 mb-8 shadow-[0_0_20px_rgba(16,185,129,0.04)]">

      <h2 className="text-lg font-semibold mb-6">
        {selectedMetrics.length === 1
          ? selectedMetrics[0]
              .replace('_', ' ')
              .replace(/\b\w/g, char => char.toUpperCase())
          : 'Metrics Comparison'}
      </h2>

      <p className="text-xs text-gray-500 -mt-4 mb-5">
        Last {range ? range.label : timeRange}
        {showBand && ' - shaded area shows the min-max within each time bucket'}
      </p>

      <div
        className="h-[280px] sm:h-[360px] lg:h-[420px]"
        role="img"
        aria-label={chartDescription}
      >

        <Line
          data={data}
          options={options}
        />

      </div>

    </div>

  )

}










