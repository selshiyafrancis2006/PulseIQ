import { useEffect, useState } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler
} from 'chart.js'
import { apiFetch } from '../../utils/apiFetch'
import { API_BASE_URL } from '../../config/api'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler
)

const metricColors = {
  cpu_usage: '#10b981',
  memory_usage: '#3b82f6',
  disk_usage: '#f59e0b',
  network_in: '#8b5cf6',
  network_out: '#ef4444'
}

const metricLabels = {
  cpu_usage: 'CPU Usage',
  memory_usage: 'Memory Usage',
  disk_usage: 'Disk Usage',
  network_in: 'Network In',
  network_out: 'Network Out'
}

export default function MetricChartWidget({ hostId, metric, hostName }) {

  const [metrics, setMetrics] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {

    if (!hostId) return

    const fetchMetrics = async () => {
      try {
        const res = await apiFetch(
          `${API_BASE_URL}/api/metrics?range=5m&host_id=${hostId}`
        )
        const data = await res.json()
        setMetrics(data)
      } catch (err) {
        console.error('Widget failed to fetch metrics:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchMetrics()

    const interval = setInterval(fetchMetrics, 5000)
    return () => clearInterval(interval)

  }, [hostId, metric])

  const color = metricColors[metric] || '#10b981'

  const data = {
    labels: metrics.map((m) => new Date(m.timestamp).toLocaleTimeString()),
    datasets: [
      {
        data: metrics.map((m) => parseFloat(m[metric])),
        borderColor: color,
        backgroundColor: color + '20',
        borderWidth: 2,
        fill: true,
        pointRadius: 0,
        tension: 0.35
      }
    ]
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: '#2a2a2a' }, ticks: { color: '#777', maxTicksLimit: 5 } },
      y: { beginAtZero: true, grid: { color: '#2a2a2a' }, ticks: { color: '#777' } }
    }
  }

  return (
    <div className="h-full flex flex-col p-3">
      <p className="text-xs text-gray-500 mb-2">
        {metricLabels[metric] || metric} · {hostName}
      </p>
      <div className="flex-1 min-h-0">
        {loading ? (
          <p className="text-xs text-gray-600">Loading...</p>
        ) : metrics.length === 0 ? (
          <p className="text-xs text-gray-600">No data yet</p>
        ) : (
          <Line data={data} options={options} />
        )}
      </div>
    </div>
  )
}