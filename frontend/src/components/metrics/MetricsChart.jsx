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
import { useState } from 'react'

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

// Window and label for every range the UI offers
const RANGES = {
  '1m': { minutes: 1, label: '1 minute' },
  '5m': { minutes: 5, label: '5 minutes' },
  '15m': { minutes: 15, label: '15 minutes' },
  '1h': { minutes: 60, label: '1 hour' },
  '6h': { minutes: 360, label: '6 hours' },
  '24h': { minutes: 1440, label: '24 hours' },
  '3d': { minutes: 4320, label: '3 days' },
  '7d': { minutes: 10080, label: '7 days' }
}

export default function MetricsChart({
  metrics,
  selectedMetrics,
  timeRange
}) {

  const [now] = useState(() => Date.now())

  if (!metrics.length) return null

   const range = RANGES[timeRange]

  // Unknown range: show everything the API returned rather than nothing
  const filteredMetrics = range
    ? metrics.filter(metric =>
        new Date(metric.timestamp).getTime() >=
                now - range.minutes * 60 * 1000
      )
    : metrics

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

  const labels = filteredMetrics.map(metric =>
    formatLabel(metric.timestamp)
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
        Last {range ? range.label : timeRange}
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