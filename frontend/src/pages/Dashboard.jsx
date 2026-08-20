import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../utils/apiFetch'
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

const MAX_POINTS = 100

export default function App() {

  const [metrics, setMetrics] = useState([])
  const [latest, setLatest] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [connected, setConnected] = useState(false)
  const [lastUpdated, setLastUpdated] = useState('')
  const [alertRules, setAlertRules] = useState([])
  const [timeRange, setTimeRange] = useState('1m')
  const [systemInfo, setSystemInfo] = useState(null)
  const [monitors, setMonitors] = useState([]);

  const navigate = useNavigate()
  const wsRef = useRef(null)

  /* =========================
     WEBSOCKET LIVE STREAM
  ========================= */
  useEffect(() => {

    let socket;
    let reconnectTimer;

    // FIX: Extracted into a function to allow auto-reconnect
    const connect = () => {

      socket = new WebSocket('ws://localhost:5000');
      wsRef.current = socket;

      socket.onopen = () => {
        console.log('WebSocket connected');
        setConnected(true);
      };

      // FIX: Wrapped JSON.parse in try/catch to handle malformed data
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (Array.isArray(data)) {
            setMetrics(data.reverse());
          } else {
            setLatest(data);
            setMetrics(prev => [
              ...prev.slice(-(MAX_POINTS - 1)),
              data
            ]);
            setLastUpdated(
              new Date().toLocaleTimeString()
            );
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', event.data);
        }
      };

      // FIX: Log useful details instead of the raw Event object
      socket.onerror = () => {
        console.error('WebSocket error — could not reach ws://localhost:5000');
      };

      // FIX: Auto-reconnect after 3 seconds on disconnect
      socket.onclose = (event) => {
        console.warn(`WebSocket closed (code: ${event.code})`);
        setConnected(false);
        reconnectTimer = setTimeout(connect, 3000);
      };

    };

    reconnectTimer = setTimeout(connect, 1000);

    return () => {
      clearTimeout(reconnectTimer);
      socket?.close();
    };

  }, []);

  /* =========================
     ALERTS FETCH
  ========================= */

  useEffect(() => {

    const fetchAlerts = async () => {

      try {

        const res = await apiFetch(
          'http://localhost:5000/api/alerts'
        )
        const data = await res.json()

        setAlerts(data)

      } catch (err) {

        console.error(
          'Failed to fetch alerts:',
          err
        )

      }

    }

    fetchAlerts()

    const interval = setInterval(
      fetchAlerts,
      10000
    )

    return () => clearInterval(interval)

  }, [])

  /* =========================
     SYSTEM INFO
  ========================= */

  useEffect(() => {

    const fetchSystemInfo = async () => {

      try {

        const res = await fetch(
          'http://localhost:5000/api/system-info'
        )

        const data = await res.json()

        setSystemInfo(data)

      } catch (err) {

        console.error(
          'Failed to fetch system info:',
          err
        )

      }

    }

    fetchSystemInfo()

  }, [])

  /* =========================
   ALERT RULES FETCH
========================= */

useEffect(() => {

  const fetchRules = async () => {
    try {
      const res = await apiFetch('http://localhost:5000/api/alert-rules')
      const data = await res.json()
      setAlertRules(data)
    } catch (err) {
      console.error('Failed to fetch alert rules:', err)
    }
  }

  fetchRules()

}, [])

  /* =========================
     HISTORICAL METRICS
  ========================= */

  useEffect(() => {

    const fetchMetrics = async () => {

      try {

        const res = await apiFetch(
          `http://localhost:5000/api/metrics?range=${timeRange}`
        )

        const data = await res.json()

        setMetrics(data.reverse())

      } catch (err) {

        console.error(
          'Failed to fetch metrics:',
          err
        )

      }

    }

    fetchMetrics()

  }, [timeRange])

  /* =========================
     CHART DATA
  ========================= */

  const labels = metrics.map(metric =>
    new Date(metric.timestamp)
      .toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
  )

  const chartData = (key, color) => ({

    labels,

    datasets: [
      {
        label: key,

        data: metrics.map(m =>
          parseFloat(m[key])
        ),

        borderColor: color,
        backgroundColor: color + '22',

        borderWidth: 2,
        pointRadius: 3,
        tension: 0.4,
        fill: true,
      }
    ]

  })

  const chartOptions = {

    responsive: true,
    animation: false,

    scales: {

      y: {

        beginAtZero: true,

        grid: {
          color: '#2a2a2a'
        },

        ticks: {
          color: '#888'
        }

      },

      x: {

        grid: {
          color: '#2a2a2a'
        },

        ticks: {
          color: '#888'
        }

      }

    },

    plugins: {

      legend: {
        display: false
      }

    }

  }

  useEffect(() => {

  const fetchMonitors = async () => {

    try {

      const response = await apiFetch(
        'http://localhost:5000/api/monitors/status'
      );

      const data = await response.json();

      setMonitors(data);

    } catch (error) {

      console.error(error);

    }

  };

  fetchMonitors();

}, []);
  /* =========================
     HELPERS
  ========================= */

  const isWarning = (
    value,
    threshold
  ) => parseFloat(value) > threshold

  const getSystemHealth = (
    cpu,
    memory
  ) => {

    if (cpu > 90 || memory > 90) {

      return {
        label: 'Critical',
        color: 'text-red-500',
        icon: '🔴'
      }

    }

    if (cpu > 75 || memory > 75) {

      return {
        label: 'Warning',
        color: 'text-yellow-400',
        icon: '🟡'
      }

    }

    return {
      label: 'Healthy',
      color: 'text-green-500',
      icon: '🟢'
    }

  }

  const health = latest
    ? getSystemHealth(
        latest.cpu_usage,
        latest.memory_usage
      )
    : {
        label: 'Loading...',
        color: 'text-gray-400',
        icon: '⏳'
      }

  return (

    <div className="min-h-screen bg-[#0f0f0f] text-white p-8">

      <p className="text-xs tracking-widest text-white uppercase mb-1">
        Real-time System Monitor
      </p>

      {/* HEADER */}

      <div className="flex items-center justify-between">

        <h1
          className="
            text-4xl
            font-bold
            mb-2
            cursor-pointer
            hover:text-emerald-400
            transition-colors
            inline-flex
            items-center
            gap-2
          "
          onClick={() => navigate('/')}
        >
          PulseIQ
        </h1>

        <div className="flex items-center gap-3">

          {/* LIVE STATUS */}

          <div
            className={`
              px-3 py-1 rounded-full
              text-xs font-bold
              ${connected
                ? 'text-white'
                : 'bg-red-900 text-red-400'
              }
            `}
          >
            {connected
              ? 'LIVE'
              : 'DISCONNECTED'}
          </div>

          {/* HEALTH STATUS */}

          <div
            className={`
              px-4 py-2
              rounded-full
              text-sm
              font-bold
              bg-[#1a1a1a]
              border border-[#2a2a2a]
              ${health.color}
            `}
          >
            {health.icon} {health.label}
          </div>

        </div>

      </div>

      <p className="text-sm text-white mt-2 mb-4">
        Last Updated: {lastUpdated || '--'}
      </p>

      {/* ALERTS */}

      {/* RECENT ALERTS */}

{alerts.length > 0 && (

  <div className="mb-8">

    <div className="flex items-center justify-between mb-4">

      <h2 className="
        text-2xl
        font-bold
        text-emerald-400
      ">
        Recent Alerts
      </h2>

    </div>

    <div className="
      bg-[#1a1a1a]
      border border-[#2a2a2a]
      rounded-xl
      overflow-hidden
    ">

      {alerts.slice(0, 5).map((alert, index) => {

        const severity = {
  label: alert.severity,
  color:
    alert.severity === "Critical"
      ? "text-red-400"
      : alert.severity === "Warning"
      ? "text-yellow-400"
      : alert.severity === "Normal"
      ? "text-emerald-400"
      : "text-gray-400"
}

        return (

          <div
            key={alert.id}
            className={`
              flex items-center
              justify-between
              px-5 py-4
              ${
                index !== 4
                  ? 'border-b border-[#2a2a2a]'
                  : ''
              }
            `}
          >

            <div className="flex items-center gap-3">

              <span className={severity.color}>
                ●
              </span>

              <div>

                <p className="text-white text-sm">

                  {(alert.metric_name ?? 'Unknown Metric').replace(/_/g, ' ')}

                  {' '}exceeded threshold

                </p>

                <p className="
                  text-xs
                  text-gray-500
                  mt-1
                ">

                  Current:{' '}
{parseFloat(
  alert.current_value
).toFixed(2)}
                  {' '}|

                  Threshold:
{' '}
{parseFloat(
  alert.threshold_value
).toFixed(2)}

                </p>

              </div>

            </div>

            <span className={`
              text-xs
              font-semibold
              uppercase
              ${severity.color}
            `}>
              {severity.label}
            </span>

          </div>

        )

      })}

    </div>

  </div>

)}

      {/* METRIC CARDS */}

      <div className="
        grid
        grid-cols-2
        md:grid-cols-4
        gap-4
        mb-8
      ">

        {[
          {
            label: 'CPU Usage',
            key: 'cpu_usage',
            threshold: 80,
            unit: '%',
            color: 'text-emerald-400'
          },
          {
            label: 'Memory Usage',
            key: 'memory_usage',
            threshold: 85,
            unit: '%',
            color: 'text-emerald-400'
          },
          {
            label: 'Disk Usage',
            key: 'disk_usage',
            threshold: 90,
            unit: '%',
            color: 'text-emerald-400'
          },
          {
            label: 'Network In',
            key: 'network_in',
            threshold: 1000,
            unit: ' KB/s',
            color: 'text-emerald-400'
          },
        ].map(({
          label,
          key,
          threshold,
          unit,
          color
        }) => (

          <div
            key={key}
            className="
              bg-[#1a1a1a]
              border border-[#2a2a2a]
              rounded-xl
              p-5
            "
          >

            <p className="
              text-xs
              text-gray-500
              uppercase
              tracking-widest
              mb-2
            ">
              {label}
            </p>

            <p className={`text-4xl font-bold ${color}`}>

              {latest
                ? parseFloat(
                    latest[key]
                  ).toFixed(1)
                : '--'}

              <span className="
                text-lg
                font-normal
                text-gray-500
              ">
                {unit}
              </span>

            </p>

          </div>

        ))}

      </div>


      {/* SYSTEM INFO */}

      {systemInfo && (

        <div className="
          bg-[#1a1a1a]
          border border-[#2a2a2a]
          rounded-xl
          p-5
          mb-8
        ">

          <h2 className="
            text-lg
            font-semibold
            mb-4
            text-white
          ">
            System Information
          </h2>

          <div className="
            grid
            grid-cols-1
            md:grid-cols-2
            gap-4
            text-sm
          ">

            <div>
              <span className="text-gray-500">
                Hostname:
              </span>

              <span className="ml-2 text-white">
                {systemInfo.hostname}
              </span>
            </div>

            <div>
              <span className="text-gray-500">
                OS:
              </span>

              <span className="ml-2 text-white">
                {systemInfo.os}
              </span>
            </div>

            <div>
              <span className="text-gray-500">
                CPU:
              </span>

              <span className="ml-2 text-white">
                {systemInfo.cpu}
              </span>
            </div>

            <div>
              <span className="text-gray-500">
                RAM:
              </span>

              <span className="ml-2 text-white">
                {systemInfo.ram}
              </span>
            </div>

            <div>
              <span className="text-gray-500">
                Uptime:
              </span>

              <span className="ml-2 text-white">
                {systemInfo.uptime}
              </span>
            </div>

          </div>

        </div>

      )}

      {/* TIME RANGE */}

      <div className="flex justify-end mb-4">

        <select

          value={timeRange}

          onChange={(e) =>
            setTimeRange(
              e.target.value
            )
          }

          className="
            bg-[#1a1a1a]
            border border-[#2a2a2a]
            text-white
            px-4 py-2
            rounded-lg
            outline-none
          "
        >

          <option value="1m">Last 1 Min</option>
          <option value="5m">Last 5 Min</option>
          <option value="15m">Last 15 Min</option>
          <option value="1h">Last 1 Hour</option>

        </select>

      </div>

      {/* CHARTS */}

      <div className="
        grid
        grid-cols-1
        md:grid-cols-2
        gap-4
      ">

        {[
          {
            label: 'CPU Usage %',
            key: 'cpu_usage',
            color: '#10b981'
          },
          {
            label: 'Memory Usage %',
            key: 'memory_usage',
            color: '#10b981'
          },
          {
            label: 'Disk Usage %',
            key: 'disk_usage',
            color: '#10b981'
          },
          {
            label: 'Network In (KB/s)',
            key: 'network_in',
            color: '#10b981'
          },
        ].map(({
          label,
          key,
          color
        }) => (

          <div
            key={key}
            className="
              bg-[#1a1a1a]
              border border-[#2a2a2a]
              rounded-xl
              p-5
            "
          >

            <h3 className="
              text-sm
              text-gray-400
              mb-4
            ">
              {label}
            </h3>

            <Line
              data={chartData(key, color)}
              options={chartOptions}
            />

          </div>

        ))}

      </div>

    </div>

  )

}