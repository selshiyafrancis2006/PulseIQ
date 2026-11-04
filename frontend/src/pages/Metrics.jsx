import { useEffect, useState } from 'react'
import { apiFetch } from '../utils/apiFetch'
import { API_BASE_URL } from '../config/api'
import { formatMetricColumnHeader } from '../utils/metricFormatting'
import useHosts from '../hooks/useHosts'
import HostSelector from '../components/shared/hostSelector'

import MetricSelector from '../components/metrics/MetricSelector'
import StatsCards from '../components/metrics/StatsCards'
import MetricsChart from '../components/metrics/MetricsChart'
import MetricsTable from '../components/metrics/MetricsTable'

// Quote a CSV field when it contains a comma, quote or newline
const csvField = (value) => {

  if (value === null || value === undefined) return ''

  const text = String(value)

  return /[",\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text

}

const safeFilePart = (text) =>
  String(text).replace(/[^a-zA-Z0-9_-]+/g, '_')

export default function Metrics() {

  const { hosts, selectedHostId, setSelectedHostId } = useHosts()

  const [metrics, setMetrics] = useState([])
  const [error, setError] = useState(null)
  const [selectedMetrics, setSelectedMetrics] = useState([
    'cpu_usage'
  ])
  const [timeRange, setTimeRange] = useState('1m')

  useEffect(() => {

    if (!selectedHostId) {
      return
    }

    // Set when this effect is replaced (host/range changed or unmounted),
    // so a slow response for the old selection can't overwrite new data.
    let ignore = false

    // Don't show the previous host/range's data while the new one loads
    setMetrics([])
    setError(null)

    const fetchMetrics = async () => {

      try {

        const res = await apiFetch(
          `${API_BASE_URL}/api/metrics?range=${timeRange}&host_id=${selectedHostId}`
        )

        if (!res.ok) {

          console.error(
            'Failed to fetch metrics',
            new Error('Metrics request failed: ' + res.status)
          )

          let message = `Failed to load metrics (HTTP ${res.status})`

          try {
            const body = await res.json()
            if (body && typeof body.error === 'string') {
              message = body.error
            }
          } catch {
            // body was not JSON - keep the generic message
          }

          if (!ignore) setError(message)

          return

        }

        const data = await res.json()

        if (!Array.isArray(data)) {
          if (!ignore) setError('Unexpected response from the server')
          return
        }

        if (!ignore) {
          setMetrics(data)
          setError(null)
        }

      } catch (err) {

        console.error(
          'Failed to fetch metrics',
          err
        )

        if (!ignore) {
          setError('Could not reach the server')
        }

      }

    }

    fetchMetrics()

    const interval = setInterval(
      fetchMetrics,
      5000
    )

    return () => {
      ignore = true
      clearInterval(interval)
    }

  }, [timeRange, selectedHostId])

  const exportCSV = () => {

    if (!metrics.length) return

    const host = hosts.find(h => h.id === selectedHostId)

    // Include host identity and rollup sample counts in the export.
    const columns = [
      { key: 'timestamp', header: 'timestamp' },
      { key: 'host_id', header: 'host_id' },
      { key: 'host_name', header: 'host_name' }
    ]

    selectedMetrics.forEach(name => {
      columns.push({
        key: name,
        header: formatMetricColumnHeader(name)
      })

      if (metrics.some(row => row[`${name}_max`] !== undefined)) {
        columns.push(
          {
            key: `${name}_min`,
            header: formatMetricColumnHeader(`${name}_min`)
          },
          {
            key: `${name}_max`,
            header: formatMetricColumnHeader(`${name}_max`)
          }
        )
      }
    })

    if (metrics.some(row => row.sample_count !== undefined)) {
      columns.push({ key: 'sample_count', header: 'sample_count' })
    }

    const rows = metrics.map(row =>
      columns.map(({ key }) => {
        if (key === 'timestamp') {
          return row.collected_at ?? row.timestamp
        }
        if (key === 'host_id') return selectedHostId
        if (key === 'host_name') return host?.name ?? ''
        return row[key]
      })
    )
    const csv = [columns.map(column => column.header), ...rows]
      .map(row => row.map(csvField).join(','))
      .join('\n')

    const blob = new Blob(
      [csv],
      {
        type: 'text/csv'
      }
    )

    const url =
      window.URL.createObjectURL(blob)

    const link =
      document.createElement('a')

    link.href = url

    link.download =
      `${safeFilePart(host?.name ?? `host_${selectedHostId}`)}_${timeRange}_metrics.csv`

    link.click()

    window.URL.revokeObjectURL(url)

  }

  return (

    <div>

      <div className="flex justify-between items-center mb-8">

        <div>

          <h1 className="text-3xl font-bold text-white">
            Metrics Explorer
          </h1>

          <p className="text-gray-400 mt-1">
            Explore historical system metrics.
          </p>

        </div>

        <div className="flex items-center gap-3">

          <HostSelector
            hosts={hosts}
            selectedHostId={selectedHostId}
            onChange={setSelectedHostId}
          />

          <button
            onClick={exportCSV}
            disabled={!metrics.length}
            className="
              bg-emerald-600
              hover:bg-emerald-700
              disabled:opacity-50
              disabled:cursor-not-allowed
              px-5
              py-2
              rounded-lg
              font-medium
            "
          >
            Export CSV
          </button>

        </div>

      </div>

      <MetricSelector
        selectedMetrics={selectedMetrics}
        setSelectedMetrics={setSelectedMetrics}
        timeRange={timeRange}
        setTimeRange={setTimeRange}
      />

      {error && (
        <div
          role="alert"
          className="
            mb-6
            px-4
            py-3
            rounded-lg
            border
            border-red-500/40
            bg-red-500/10
            text-red-300
            text-sm
          "
        >
          {error}
        </div>
      )}

      <StatsCards
        metrics={metrics}
        selectedMetric={selectedMetrics[0]}
      />

      <MetricsChart
        metrics={metrics}
        selectedMetrics={selectedMetrics}
        timeRange={timeRange}
      />

      <MetricsTable
        metrics={metrics}
        selectedMetric={selectedMetrics[0]}
      />

    </div>

  )

}
