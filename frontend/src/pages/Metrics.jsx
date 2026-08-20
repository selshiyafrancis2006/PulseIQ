import { useEffect, useState } from 'react'
import { apiFetch } from '../utils/apiFetch'
import { API_BASE_URL } from '../config/api'

import MetricSelector from '../components/metrics/MetricSelector'
import StatsCards from '../components/metrics/StatsCards'
import MetricsChart from '../components/metrics/MetricsChart'
import MetricsTable from '../components/metrics/MetricsTable'

export default function Metrics() {

  const [metrics, setMetrics] = useState([])
  const [selectedMetrics, setSelectedMetrics] = useState([
  'cpu_usage'
])
  const [timeRange, setTimeRange] = useState('1m')

  useEffect(() => {

    const fetchMetrics = async () => {

      try {

        const res = await apiFetch(
          `${API_BASE_URL}/api/metrics?range=${timeRange}`
        )

        const data = await res.json()

        setMetrics(data)

      } catch (err) {

        console.error(
          'Failed to fetch metrics',
          err
        )

      }

    }

    fetchMetrics()

    const interval = setInterval(
      fetchMetrics,
      5000
    )

    return () => clearInterval(interval)

  }, [timeRange])

  const exportCSV = () => {

    if (!metrics.length) return

    const csv = [

      ['Timestamp', 'Value'],

      ...metrics.map(metric => [

        metric.timestamp,

        metric[selectedMetrics[0]]

      ])

    ]
      .map(row => row.join(','))
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
      `${selectedMetrics[0]}.csv`

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

        <button
          onClick={exportCSV}
          className="
            bg-emerald-600
            hover:bg-emerald-700
            px-5
            py-2
            rounded-lg
            font-medium
          "
        >
          Export CSV
        </button>

      </div>

      <MetricSelector
  selectedMetrics={selectedMetrics}
  setSelectedMetrics={setSelectedMetrics}
  timeRange={timeRange}
  setTimeRange={setTimeRange}
/>

      <StatsCards
        metrics={metrics}
        selectedMetric={selectedMetrics[0]}
      />

      <MetricsChart
        metrics={metrics}
        selectedMetrics={selectedMetrics}
      />

      <MetricsTable
        metrics={metrics}
        selectedMetrics={selectedMetrics[0]}
      />

    </div>

  )

}