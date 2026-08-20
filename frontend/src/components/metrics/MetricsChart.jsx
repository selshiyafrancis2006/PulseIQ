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
  memory_usage: '#3b82f6',
  disk_usage: '#f59e0b',
  network_in: '#8b5cf6',
  network_out: '#ef4444'
}

export default function MetricsChart({
  metrics,
  selectedMetrics
}) {

  if (!metrics.length) return null

  const labels = metrics.map(metric =>
    new Date(metric.timestamp).toLocaleTimeString()
  )

  const datasets = selectedMetrics.map(metric => ({

    label: metric
      .replace('_', ' ')
      .toUpperCase(),

    data: metrics.map(item =>
      parseFloat(item[metric])
    ),

    borderColor: metricColors[metric],

    backgroundColor: metricColors[metric] + '20',

    borderWidth: 2,

    fill: false,

    pointRadius: 2,

    pointHoverRadius: 5,

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

    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6 mb-8">

      <h2 className="text-lg font-semibold mb-6">
        Metrics Comparison
      </h2>

      <div className="h-[420px]">

        <Line
          data={data}
          options={options}
        />

      </div>

    </div>

  )

}