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
  memory_usage: '#10b981',
  disk_usage: '#10b981',
  network_in: '#10b981',
  network_out: '#10b981'
}

export default function MetricsChart({
  metrics,
  selectedMetrics,
  timeRange
}) {

  if (!metrics.length) return null
  const rangeMinutes = {
  '1h': 60,
  '6h': 360,
  '24h': 1440
}

const cutoff = Date.now() - rangeMinutes[timeRange] * 60 * 1000

const filteredMetrics = metrics.filter(metric =>
  new Date(metric.timestamp).getTime() >= cutoff
)

  const labels = filteredMetrics.map(metric =>
    new Date(metric.timestamp).toLocaleTimeString()
  )

  const datasets = selectedMetrics.map(metric => ({

    label: metric
      .replace('_', ' ')
      .toUpperCase(),

    data: filteredMetrics.map(item =>
  parseFloat(item[metric])
),

    borderColor: metricColors[metric],

    backgroundColor: metricColors[metric] + '20',

    borderWidth: 2,

    fill: false,

pointRadius: 0,
pointHoverRadius: 4,
tension: 0.35

  }))

  const data = {

    labels,

    datasets

  }

  const options = {

    responsive: true,

    maintainAspectRatio: false,

    animation: false,

    plugins: {

      legend: {
        display: true,
        labels: {
          color: '#ffffff'
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
          color: '#777'
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
  Last {timeRange === '1h' ? '1 hour' : timeRange === '6h' ? '6 hours' : '24 hours'}
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