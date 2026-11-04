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
  getMetricTimestamp
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
  timeRange
}) {

  const now = Date.now()

  if (!metrics.length) return null

  const range = RANGES[timeRange]

  // Unknown range: show everything the API returned rather than nothing
  const filteredMetrics = range
    ? metrics.filter(metric =>
        getMetricTimestamp(metric) >=
          now - range.minutes * 60 * 1000
      )
    : metrics

  // Points include empty placeholders where samples are missing, so the
  // line breaks across an outage instead of joining over it
  const chartPoints = buildMetricChartPoints(filteredMetrics, timeRange)

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

  // The min-max band is drawn for one metric at a time, and only when the
  // rows carry min/max (rollup ranges: 6h and longer).
  const bandMetric =
    selectedMetrics.length === 1 ? selectedMetrics[0] : null

  const showBand =
    bandMetric !== null &&
    chartPoints.some(point =>
      point.metric &&
      toNumber(point.metric[`${bandMetric}_max`]) !== null
    )

  const datasets = selectedMetrics.map(metric => {

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

      // Lower order is drawn on top, so the line stays above the band
      order: 0

    }

  })

  if (showBand) {

    const color = metricColors[bandMetric]

    // "Max" is an invisible line; "Min" fills up to it ('-1' = the dataset
    // before it), which draws the shaded band between the two.
    datasets.push({
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

    datasets.push({
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

  const data = {

    labels,

    datasets

  }

  const options = {

    responsive: true,

    maintainAspectRatio: false,

    animation: false,

    // With a band, hovering shows average, max and min together
    interaction: showBand
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

    <div className="bg-[#0d0d0d] border border-emerald-500/20 rounded-xl p-6 mb-8 shadow-[0_0_20px_rgba(16,185,129,0.04)]">

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

      <div className="h-[420px]">

        <Line
          data={data}
          options={options}
        />

      </div>

    </div>

  )

}





