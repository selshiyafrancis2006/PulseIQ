import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../utils/apiFetch'
import { API_BASE_URL } from '../../config/api'
import CustomMetricsChart from './CustomMetricsChart'
import CustomMetricsTable from './CustomMetricsTable'
import MetricsSkeleton from './MetricsSkeleton'

const RANGE_OPTIONS = [
  { value: '1m', label: 'Last 1 Minute', ms: 60 * 1000 },
  { value: '5m', label: 'Last 5 Minutes', ms: 5 * 60 * 1000 },
  { value: '15m', label: 'Last 15 Minutes', ms: 15 * 60 * 1000 },
  { value: '1h', label: 'Last 1 Hour', ms: 60 * 60 * 1000 },
  { value: '6h', label: 'Last 6 Hours', ms: 6 * 60 * 60 * 1000 },
  { value: '24h', label: 'Last 24 Hours', ms: 24 * 60 * 60 * 1000 },
  { value: '3d', label: 'Last 3 Days', ms: 3 * 24 * 60 * 60 * 1000 }
]

const STEPS = ['1m', '5m', '15m', '1h', '6h', '1d']
const AGGREGATIONS = ['avg', 'min', 'max']

const csvField = (value) => {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text
}

export default function CustomMetricsExplorer({ hostId, hostName }) {
  const [discoveredMetrics, setDiscoveredMetrics] = useState([])
  const [selectedMetric, setSelectedMetric] = useState('')
  const [discoveryLoading, setDiscoveryLoading] = useState(false)
  const [discoveryError, setDiscoveryError] = useState(null)

  const [timeRange, setTimeRange] = useState('1h')
  const [step, setStep] = useState('1m')
  const [aggregation, setAggregation] = useState('avg')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [rangeNow, setRangeNow] = useState(Date.now())

  const [queryResult, setQueryResult] = useState({
    hostId: null,
    metricName: null,
    rangeKey: null,
    step: null,
    aggregation: null,
    data: []
  })
  const [queryError, setQueryError] = useState(null)
  const [queryLoading, setQueryLoading] = useState(false)

  const range = useMemo(() => {
    if (timeRange === 'custom') {
      const from = new Date(customFrom).getTime()
      const to = new Date(customTo).getTime()
      const now = rangeNow

      if (!customFrom || !customTo) {
        return { error: 'Select both start and end date/time.' }
      }
      if (!Number.isFinite(from) || !Number.isFinite(to)) {
        return { error: 'Enter valid start and end date/time.' }
      }
      if (from >= to) {
        return { error: 'Start must be before end.' }
      }
      if (to > now) {
        return { error: 'End time cannot be in the future.' }
      }
      if (from < now - 3 * 24 * 60 * 60 * 1000) {
        return { error: 'Custom metrics are retained for 3 days.' }
      }
      return { from, to }
    }

    const option = RANGE_OPTIONS.find(item => item.value === timeRange)
    if (!option) return { error: 'Select a valid time range.' }

    const to = rangeNow
    return { from: to - option.ms, to }
  }, [timeRange, customFrom, customTo, rangeNow])

  useEffect(() => {
    const interval = setInterval(() => setRangeNow(Date.now()), 5000)
    return () => clearInterval(interval)
  }, [])

  const rangeKey = range.from && range.to
    ? `${range.from}:${range.to}`
    : `invalid:${timeRange}:${customFrom}:${customTo}`

  useEffect(() => {
    if (!hostId) {
      setDiscoveredMetrics([])
      setSelectedMetric('')
      return
    }

    let ignore = false

    const fetchNames = async () => {
      setDiscoveryLoading(true)
      setDiscoveryError(null)

      try {
        const params = new URLSearchParams({ host_id: String(hostId) })
        const response = await apiFetch(
          `${API_BASE_URL}/api/metrics/custom/names?${params.toString()}`
        )

        if (!response.ok) {
          let message = `Failed to discover custom metrics (HTTP ${response.status})`
          try {
            const body = await response.json()
            if (typeof body?.error === 'string') message = body.error
          } catch {
            // Keep the HTTP error.
          }
          throw new Error(message)
        }

        const result = await response.json()
        if (!result || !Array.isArray(result.metrics)) {
          throw new Error('Unexpected custom metric discovery response')
        }

        if (!ignore) {
          setDiscoveredMetrics(result.metrics)
          setSelectedMetric(current =>
            result.metrics.some(item => item.metric_name === current)
              ? current
              : result.metrics[0]?.metric_name ?? ''
          )
        }
      } catch (error) {
        if (!ignore) {
          setDiscoveredMetrics([])
          setSelectedMetric('')
          setDiscoveryError(error.message || 'Could not load custom metrics')
        }
      } finally {
        if (!ignore) setDiscoveryLoading(false)
      }
    }

    fetchNames()

    return () => {
      ignore = true
    }
  }, [hostId])

  useEffect(() => {
    if (!hostId || !selectedMetric || range.error || !range.from || !range.to) {
      setQueryLoading(false)
      return
    }

    let ignore = false
    let inFlight = false

    const fetchCustomMetrics = async () => {
      if (inFlight) return
      inFlight = true
      setQueryLoading(true)

      try {
        const params = new URLSearchParams({
          host_id: String(hostId),
          metric_name: selectedMetric,
          from: new Date(range.from).toISOString(),
          to: new Date(range.to).toISOString(),
          step,
          agg: aggregation
        })

        const response = await apiFetch(
          `${API_BASE_URL}/api/metrics/custom?${params.toString()}`
        )

        if (!response.ok) {
          let message = `Failed to load custom metrics (HTTP ${response.status})`
          try {
            const body = await response.json()
            if (typeof body?.error === 'string') message = body.error
          } catch {
            // Keep the HTTP error.
          }
          throw new Error(message)
        }

        const result = await response.json()
        if (!result || !Array.isArray(result.data)) {
          throw new Error('Unexpected custom metrics response')
        }

        if (!ignore) {
          setQueryResult({
            hostId,
            metricName: selectedMetric,
            rangeKey,
            step,
            aggregation,
            data: result.data
          })
          setQueryError(null)
        }
      } catch (error) {
        if (!ignore) {
          setQueryError(error.message || 'Could not load custom metrics')
        }
      } finally {
        inFlight = false
        if (!ignore) setQueryLoading(false)
      }
    }

    fetchCustomMetrics()

    return () => {
      ignore = true
    }
  }, [hostId, selectedMetric, rangeKey, range.from, range.to, range.error, step, aggregation])

  const metrics = queryResult.hostId === hostId &&
    queryResult.metricName === selectedMetric &&
    queryResult.rangeKey === rangeKey &&
    queryResult.step === step &&
    queryResult.aggregation === aggregation
    ? queryResult.data
    : []

  const hasCurrentResult = queryResult.hostId === hostId &&
    queryResult.metricName === selectedMetric &&
    queryResult.rangeKey === rangeKey &&
    queryResult.step === step &&
    queryResult.aggregation === aggregation

  const exportCSV = () => {
    if (!metrics.length) return

    const headers = [
      'timestamp',
      'metric_name',
      'value',
      'unit',
      'tags',
      'sample_count',
      'latest_sample_timestamp'
    ]

    const rows = metrics.map(row => [
      row.timestamp,
      selectedMetric,
      row.value,
      row.unit,
      JSON.stringify(row.tags ?? {}),
      row.sample_count,
      row.latest_sample_timestamp
    ])

    const csv = [headers, ...rows]
      .map(row => row.map(csvField).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    const safeHostName = String(hostName || `host_${hostId}`)
      .replace(/[^a-zA-Z0-9_-]+/g, '_')

    link.href = url
    link.download = `${safeHostName}_${selectedMetric}_custom_metrics.csv`
    link.click()
    window.URL.revokeObjectURL(url)
  }

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div>
          <label
            htmlFor="custom-metric-name"
            className="mb-2 block text-xs uppercase tracking-widest text-gray-500"
          >
            Discovered Metric
          </label>
          <select
            id="custom-metric-name"
            value={selectedMetric}
            onChange={event => setSelectedMetric(event.target.value)}
            disabled={discoveryLoading || discoveredMetrics.length === 0}
            className="w-full rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2 text-white outline-none focus:border-emerald-400 disabled:opacity-50"
          >
            <option value="">
              {discoveryLoading ? 'Discovering metrics...' : 'Select a metric'}
            </option>
            {discoveredMetrics.map(metric => (
              <option
                key={`${metric.metric_name}:${metric.unit ?? ''}`}
                value={metric.metric_name}
              >
                {metric.metric_name}{metric.unit ? ` (${metric.unit})` : ''}
              </option>
            ))}
          </select>
          {selectedMetric && discoveredMetrics.find(item =>
            item.metric_name === selectedMetric
          ) && (
            <p className="mt-2 text-xs text-gray-500">
              {discoveredMetrics.find(item =>
                item.metric_name === selectedMetric
              ).sample_count} retained samples
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="custom-metric-range"
            className="mb-2 block text-xs uppercase tracking-widest text-gray-500"
          >
            Time Range
          </label>
          <select
            id="custom-metric-range"
            value={timeRange}
            onChange={event => setTimeRange(event.target.value)}
            className="w-full rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2 text-white outline-none focus:border-emerald-400"
          >
            {RANGE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            <option value="custom">Custom Range</option>
          </select>
          {timeRange === 'custom' && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="custom-metric-from" className="mb-2 block text-xs text-gray-400">
                  Start date/time
                </label>
                <input
                  id="custom-metric-from"
                  type="datetime-local"
                  value={customFrom}
                  onChange={event => setCustomFrom(event.target.value)}
                  className="w-full rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label htmlFor="custom-metric-to" className="mb-2 block text-xs text-gray-400">
                  End date/time
                </label>
                <input
                  id="custom-metric-to"
                  type="datetime-local"
                  value={customTo}
                  onChange={event => setCustomTo(event.target.value)}
                  className="w-full rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white"
                />
              </div>
            </div>
          )}
          {range.error && (
            <p role="alert" className="mt-2 text-xs text-red-400">
              {range.error}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
        <div>
          <label htmlFor="custom-metric-step" className="mb-2 block text-xs uppercase tracking-widest text-gray-500">
            Step
          </label>
          <select
            id="custom-metric-step"
            value={step}
            onChange={event => setStep(event.target.value)}
            className="w-full rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2 text-white"
          >
            {STEPS.map(value => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="custom-metric-aggregation" className="mb-2 block text-xs uppercase tracking-widest text-gray-500">
            Aggregation
          </label>
          <select
            id="custom-metric-aggregation"
            value={aggregation}
            onChange={event => setAggregation(event.target.value)}
            className="w-full rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2 text-white"
          >
            {AGGREGATIONS.map(value => (
              <option key={value} value={value}>
                {value.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={exportCSV}
            disabled={!metrics.length}
            className="w-full rounded-lg bg-emerald-600 px-5 py-2 font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      {discoveryError && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {discoveryError}
        </div>
      )}

      {queryError && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {queryError}
        </div>
      )}

      {!hostId ? (
        <p className="rounded-lg border border-[#303030] bg-[#171717] p-5 text-sm text-gray-400">
          Select a host to discover its custom metrics.
        </p>
      ) : discoveryLoading && discoveredMetrics.length === 0 ? (
        <MetricsSkeleton />
      ) : discoveryError ? null : discoveredMetrics.length === 0 ? (
        <p className="rounded-lg border border-[#303030] bg-[#171717] p-5 text-sm text-gray-400">
          No custom metrics have been discovered for this host yet. Enable custom metric collection on its agent to begin collecting disk, network interface, and supported load metrics.
        </p>
      ) : range.error ? null : queryLoading && !hasCurrentResult ? (
        <MetricsSkeleton />
      ) : queryError ? null : metrics.length === 0 ? (
        <p className="rounded-lg border border-[#303030] bg-[#171717] p-5 text-sm text-gray-400">
          No observations for this metric in the selected range.
        </p>
      ) : (
        <>
          <CustomMetricsChart
            metrics={metrics}
            metricName={selectedMetric}
          />
          <CustomMetricsTable metrics={metrics} />
        </>
      )}
    </section>
  )
}


