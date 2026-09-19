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

const metricLabels = {
  cpu_usage: 'CPU Usage',
  memory_usage: 'Memory Usage',
  disk_usage: 'Disk Usage',
  network_in: 'Network In',
  network_out: 'Network Out'
}

export default function MetricChartWidget({ hostId, metric, hostName, timeRange }) {

  const [metrics, setMetrics] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {

    if (!hostId) return

    const fetchMetrics = async () => {
      try {
        const res = await apiFetch(
          `${API_BASE_URL}/api/metrics?range=${timeRange}&host_id=${hostId}`
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

  }, [hostId, metric, timeRange])

  const color = '#10b981' // emerald — one consistent color across every widget, matches app theme

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
      <div className="flex items-center gap-2 mb-2">
        <p className="text-sm text-white truncate">
          {metricLabels[metric] || metric} · {hostName}
        </p>
        {!loading && metrics.length > 0 && (
          <span className="relative flex h-2 w-2 shrink-0" title="Live">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="h-full w-full flex items-end gap-1 px-1 pb-1">
            {[40, 65, 50, 80, 55, 70, 45, 60].map((h, i) => (
              <div
                key={i}
                className="flex-1 bg-[#2a2a2a] rounded-t animate-pulse"
                style={{ height: `${h}%`, animationDelay: `${i * 100}ms` }}
              />
            ))}
          </div>
        ) : metrics.length === 0 ? (
          <p className="text-xs text-gray-600">No data yet</p>
        ) : (
          <Line data={data} options={options} />
        )}
      </div>
    </div>
  )
}