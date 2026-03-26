import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
)

const MAX_DATA_POINTS = 20

export default function App() {
  const [metrics, setMetrics] = useState([])
  const [latest, setLatest] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [connected, setConnected] = useState(false)
  const navigate = useNavigate()
  const wsRef = useRef(null)

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket('ws://localhost:5000')
      wsRef.current = ws

      ws.onopen = () => {
        console.log('WebSocket connected')
        setConnected(true)
      }

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data)
        setLatest(data)
        setMetrics(prev => {
          const updated = [...prev, data]
          return updated.slice(-MAX_DATA_POINTS)
        })
      }

      ws.onclose = () => {
        console.log('WebSocket disconnected — reconnecting...')
        setConnected(false)
        setTimeout(connect, 3000)
      }

      ws.onerror = (err) => {
        console.error('WebSocket error:', err)
        ws.close()
      }
    }

    connect()

    return () => {
      if (wsRef.current) wsRef.current.close()
    }
  }, [])
  
  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const res = await fetch('http://localhost:5000/api/alerts')
        const data = await res.json()
        setAlerts(data)
      } catch (err) {
        console.error('Failed to fetch alerts:', err)
      }
    }

    fetchAlerts()
    const interval = setInterval(fetchAlerts, 10000)
    return () => clearInterval(interval)
  }, [])

  const labels = metrics.map((_, i) => `${i * 5}s`)

  const chartData = (key, color) => ({
    labels,
    datasets: [{
      label: key,
      data: metrics.map(m => parseFloat(m[key]).toFixed(2)),
      borderColor: color,
      backgroundColor: color + '22',
      borderWidth: 2,
      pointRadius: 3,
      tension: 0.4,
      fill: true,
    }]
  })

  const chartOptions = {
    responsive: true,
    animation: false,
    scales: {
      y: {
        beginAtZero: true,
        grid: { color: '#2a2a2a' },
        ticks: { color: '#888' }
      },
      x: {
        grid: { color: '#2a2a2a' },
        ticks: { color: '#888' }
      }
    },
    plugins: {
      legend: { display: false }
    }
  }

  const isWarning = (value, threshold) => parseFloat(value) > threshold

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white p-8">

      {/* HEADER */}
      <div className="mb-8">
        <p className="text-xs tracking-widest text-gray-500 uppercase mb-1">Real-time System Monitor</p>
        <h1
  className="text-4xl font-bold mb-2 cursor-pointer hover:text-indigo-400 transition-colors inline-flex items-center gap-2"
  onClick={() => navigate('/')}
>PulseIQ
</h1>
        <span className={`text-xs px-3 py-1 rounded-full font-semibold ${connected ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400'}`}>
          {connected ? '● Live' : '○ Connecting...'}
        </span>
      </div>

      {/* 🔴 ALERTS PANEL */}
      {alerts.length > 0 && (
        <div className="bg-red-900/40 border border-red-800 rounded-xl p-4 mb-8">
          <h2 className="text-red-400 font-semibold mb-3">System Alerts</h2>

          {alerts.slice(0,5).map(alert => (
            <div key={alert.id} className="text-sm text-red-300 mb-1">
              ⚠ {alert.metric_name} spike detected
              ({parseFloat(alert.metric_value).toFixed(2)} vs avg {parseFloat(alert.average_value).toFixed(2)})
            </div>
          ))}
        </div>
      )}

      {/* METRIC CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'CPU Usage', key: 'cpu_usage', threshold: 80, unit: '%', color: 'text-blue-400' },
          { label: 'Memory Usage', key: 'memory_usage', threshold: 85, unit: '%', color: 'text-purple-400' },
          { label: 'Disk Usage', key: 'disk_usage', threshold: 90, unit: '%', color: 'text-yellow-400' },
          { label: 'Network In', key: 'network_in', threshold: 1000, unit: ' KB/s', color: 'text-green-400' },
        ].map(({ label, key, threshold, unit, color }) => (
          <div key={key} className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">{label}</p>
            <p className={`text-4xl font-bold ${latest && isWarning(latest[key], threshold) ? 'text-red-400' : color}`}>
              {latest ? parseFloat(latest[key]).toFixed(1) : '--'}
              <span className="text-lg font-normal text-gray-500">{unit}</span>
            </p>
          </div>
        ))}
      </div>

      {/* CHARTS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { label: 'CPU Usage %', key: 'cpu_usage', color: '#60a5fa' },
          { label: 'Memory Usage %', key: 'memory_usage', color: '#c084fc' },
          { label: 'Disk Usage %', key: 'disk_usage', color: '#facc15' },
          { label: 'Network In (KB/s)', key: 'network_in', color: '#4ade80' },
        ].map(({ label, key, color }) => (
          <div key={key} className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5">
            <h3 className="text-sm text-gray-400 mb-4">{label}</h3>
            <Line data={chartData(key, color)} options={chartOptions} />
          </div>
        ))}
      </div>

    </div>
  )
}