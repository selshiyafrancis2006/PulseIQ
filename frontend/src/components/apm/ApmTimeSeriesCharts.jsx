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
import { formatBucketLabel, toChartNumber } from '../../utils/apm'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend
)

const TICK_COLOR = '#6b7280'
const GRID_COLOR = '#2a2a2a'

const baseOptions = (unit, showLegend) => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      display: showLegend,
      labels: { color: '#9ca3af', boxWidth: 12 }
    },
    tooltip: {
      callbacks: {
        label: (context) =>
          context.parsed.y === null
            ? `${context.dataset.label}: no data`
            : `${context.dataset.label}: ${context.parsed.y.toLocaleString(undefined, {
                maximumFractionDigits: 2
              })} ${unit}`
      }
    }
  },
  scales: {
    x: {
      ticks: { color: TICK_COLOR, maxTicksLimit: 8, maxRotation: 0 },
      grid: { color: GRID_COLOR }
    },
    y: {
      beginAtZero: true,
      title: { display: true, text: unit, color: TICK_COLOR },
      ticks: { color: TICK_COLOR },
      grid: { color: GRID_COLOR }
    }
  }
})

const lineDataset = (label, color, values) => ({
  label,
  data: values,
  borderColor: color,
  backgroundColor: color,
  borderWidth: 2,
  pointRadius: 0,
  pointHoverRadius: 4,
  tension: 0.2,
  // null buckets (no traffic) leave a gap instead of joining across it
  spanGaps: false
})

function ChartPanel({ title, testId, unit, labels, datasets, showLegend = false }) {
  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5">
      <h2 className="text-lg font-semibold mb-4">{title}</h2>
      <div className="h-56" data-testid={testId}>
        <Line
          data={{ labels, datasets }}
          options={baseOptions(unit, showLegend)}
        />
      </div>
    </div>
  )
}

export default function ApmTimeSeriesCharts({ points, range }) {

  if (!points || points.length === 0) return null

  const labels = points.map((point) => formatBucketLabel(point.bucket, range))
  const column = (key) => points.map((point) => toChartNumber(point[key]))

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">

      <div className="xl:col-span-2">
        <ChartPanel
          title="Latency"
          testId="apm-latency-chart"
          unit="ms"
          showLegend
          labels={labels}
          datasets={[
            lineDataset('p50', '#10b981', column('p50_duration_ms')),
            lineDataset('p95', '#f59e0b', column('p95_duration_ms')),
            lineDataset('p99', '#fb7185', column('p99_duration_ms'))
          ]}
        />
      </div>

      <ChartPanel
        title="Throughput"
        testId="apm-throughput-chart"
        unit="req/min"
        labels={labels}
        datasets={[lineDataset('Throughput', '#38bdf8', column('throughput_rpm'))]}
      />

      <ChartPanel
        title="Error rate"
        testId="apm-error-rate-chart"
        unit="%"
        labels={labels}
        datasets={[lineDataset('Error rate (5xx)', '#ef4444', column('error_rate'))]}
      />

    </div>
  )
}