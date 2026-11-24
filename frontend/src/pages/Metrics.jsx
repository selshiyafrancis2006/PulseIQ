import { useCallback, useEffect, useRef, useState } from 'react'
import useLiveSocket from '../hooks/useLiveSocket'
import usePageVisible from '../hooks/usePageVisible'
import { apiFetch } from '../utils/apiFetch'
import { API_BASE_URL, WS_URL } from '../config/api'
import {
  getAlignedQueryRange,
  getAlignedCustomQueryRange,
  getCompatibleQuerySteps,
  isP95Available
} from '../utils/metricsQuery'
import { formatMetricColumnHeader } from '../utils/metricFormatting'
import { METRICS } from '../config/metricNames'
import { mergeLiveMetricSample } from '../utils/metricLiveUpdates'
import useHosts from '../hooks/useHosts'
import HostSelector from '../components/shared/hostSelector'
import HostComparisonSelector from '../components/metrics/HostComparisonSelector'

import MetricSelector from '../components/metrics/MetricSelector'
import StatsCards from '../components/metrics/StatsCards'
import MetricsChart from '../components/metrics/MetricsChart'
import MetricsTable from '../components/metrics/MetricsTable'
import MetricsSkeleton from '../components/metrics/MetricsSkeleton'
import MetricsEmptyState from '../components/metrics/MetricsEmptyState'
import CustomMetricsExplorer from '../components/metrics/CustomMetricsExplorer'

// Stable reference, so "no data yet" doesn't look like a change on every render
const NO_METRICS = []

const LIVE_STATUS_LABELS = {
  connecting: 'Connecting to live updates\u2026',
  live: 'Live',
  reconnecting: 'Live updates disconnected \u2014 reconnecting\u2026',
  paused: 'Paused while this tab is hidden',
  unavailable: 'Live updates unavailable \u2014 refreshing every 5 seconds'
}

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
  const [selectedComparisonHostIds, setSelectedComparisonHostIds] = useState([])
  const [metricMode, setMetricMode] = useState('system')

  const queryHostIds = selectedHostId
    ? [
        selectedHostId,
        ...selectedComparisonHostIds.filter(id =>
          String(id) !== String(selectedHostId) &&
          hosts.some(host => String(host.id) === String(id))
        )
      ]
    : []

  const hostIdsKey = queryHostIds.map(String).join(',')

  const [metricsResult, setMetricsResult] = useState({ hostId: null, hostIdsKey: null, range: null, step: null, aggregation: null, data: [] })
  const [errorResult, setErrorResult] = useState({ hostId: null, hostIdsKey: null, range: null, step: null, aggregation: null, message: null })
  const [selectedMetrics, setSelectedMetrics] = useState([
    'cpu_usage'
  ])
  const [timeRange, setTimeRange] = useState('1m')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [step, setStep] = useState('1m')
  const [aggregation, setAggregation] = useState('avg')
  const metricsPageNow = Date.now()
  const pendingSocketSamplesRef = useRef([])
  const liveUpdateRevisionRef = useRef(0)
  const customFromTimestamp = customFrom ? new Date(customFrom).getTime() : NaN
  const customToTimestamp = customTo ? new Date(customTo).getTime() : NaN

  let customRangeError = null
  let queryRange = null

  if (timeRange === 'custom') {
    if (!customFrom || !customTo) {
      customRangeError = 'Select both start and end date/time.'
    } else if (!Number.isFinite(customFromTimestamp) || !Number.isFinite(customToTimestamp)) {
      customRangeError = 'Enter valid start and end date/time.'
    } else if (customFromTimestamp >= customToTimestamp) {
      customRangeError = 'Start must be before end.'
    } else if (customToTimestamp > metricsPageNow) {
      customRangeError = 'End time cannot be in the future.'
    } else if (customFromTimestamp < metricsPageNow - 90 * 24 * 60 * 60 * 1000) {
      customRangeError = 'Start cannot be older than 90 days.'
    } else {
      queryRange = getAlignedCustomQueryRange(customFromTimestamp, customToTimestamp)
      if (!queryRange) {
        customRangeError = 'Selected range is too short for the available resolution.'
      }
    }
  } else {
    queryRange = getAlignedQueryRange(timeRange)
  }

  const compatibleSteps = queryRange
    ? getCompatibleQuerySteps(queryRange.resolutionMs)
    : []
  const effectiveStep = compatibleSteps.includes(step)
    ? step
    : compatibleSteps[0] ?? '1m'
  const p95Available = queryRange
    ? isP95Available(queryRange.from, queryRange.to)
    : false
  const effectiveAggregation =
    aggregation === 'p95' && !p95Available ? 'avg' : aggregation


  const queryRangeKey = timeRange === 'custom'
    ? queryRange
      ? `custom:${queryRange.from}:${queryRange.to}`
      : `custom:invalid:${customFrom}:${customTo}`
    : timeRange
  const queryRangeFrom = queryRange?.from ?? null
  const queryRangeTo = queryRange?.to ?? null
  const shouldUseLiveUpdates =
    metricMode === 'system' &&
    timeRange !== 'custom' &&
    ['1m', '5m', '15m'].includes(timeRange) &&
    ['avg', 'min', 'max'].includes(effectiveAggregation) &&
    queryHostIds.length === 1 &&
    Boolean(selectedHostId) &&
    queryRangeFrom !== null &&
    queryRangeTo !== null


  const pageVisible = usePageVisible()
  const liveToken = shouldUseLiveUpdates ? localStorage.getItem('token') : null
  const liveUrl = liveToken
    ? `${WS_URL}?token=${encodeURIComponent(liveToken)}&host_id=${encodeURIComponent(selectedHostId)}`
    : null

  const handleSocketMessage = useCallback((event) => {
    try {
      const data = JSON.parse(event.data)

      if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data) ||
        String(data.host_id) !== String(selectedHostId)
      ) {
        return
      }

      const mergeOptions = {
        step: effectiveStep,
        aggregation: effectiveAggregation,
        from: queryRangeFrom,
        to: queryRangeTo
      }

      const validatedSample = mergeLiveMetricSample([], data, mergeOptions)
      if (validatedSample.length !== 1) return

      const sampleKey = data.sample_id
        ? `id:${data.host_id}:${data.sample_id}`
        : `timestamp:${data.host_id}:${data.collected_at || data.timestamp}`

      if (pendingSocketSamplesRef.current.some(sample => sample.key === sampleKey)) {
        return
      }

      pendingSocketSamplesRef.current = [
        ...pendingSocketSamplesRef.current,
        { key: sampleKey, data }
      ].slice(-500)

      liveUpdateRevisionRef.current += 1

      setMetricsResult(current => {
        if (
          current.hostId !== selectedHostId ||
          current.hostIdsKey !== hostIdsKey ||
          current.range !== queryRangeKey ||
          current.step !== effectiveStep ||
          current.aggregation !== effectiveAggregation
        ) {
          return current
        }

        return {
          ...current,
          data: mergeLiveMetricSample(current.data, data, mergeOptions)
        }
      })
    } catch {
      console.error('Failed to parse Metrics WebSocket message')
    }
  }, [
    selectedHostId,
    hostIdsKey,
    queryRangeKey,
    queryRangeFrom,
    queryRangeTo,
    effectiveStep,
    effectiveAggregation
  ])

  const liveStatus = useLiveSocket({
    url: liveUrl,
    paused: !pageVisible,
    onMessage: handleSocketMessage
  })

  const pollIntervalMs = liveStatus === 'live' ? 60000 : 5000

  useEffect(() => {
    if (metricMode !== 'system' || !pageVisible || !hostIdsKey || queryRangeFrom === null || queryRangeTo === null) {
      return
    }

    let ignore = false
    let requestInFlight = false
    let retryTimer = null

    const fetchMetrics = async () => {
      if (requestInFlight || !pageVisible) return

      requestInFlight = true
      const requestRevision = liveUpdateRevisionRef.current
      try {
        const currentQueryRange = { from: queryRangeFrom, to: queryRangeTo }

        if (!currentQueryRange) {
          return
        }

        const params = new URLSearchParams({
          host_ids: hostIdsKey,
          from: new Date(currentQueryRange.from).toISOString(),
          to: new Date(currentQueryRange.to).toISOString(),
          step: effectiveStep,
          agg: effectiveAggregation
        })

        const res = await apiFetch(
          `${API_BASE_URL}/api/metrics/query?${params.toString()}`
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
            // Keep the generic message when the body is not JSON.
          }

          if (!ignore && requestRevision === liveUpdateRevisionRef.current) {
            setErrorResult({
              hostId: selectedHostId,
              hostIdsKey,
              range: queryRangeKey,
              step: effectiveStep,
              aggregation: effectiveAggregation,
              message
            })
          }

          return
        }

        const result = await res.json()

        if (!result || !Array.isArray(result.data)) {
          if (!ignore && requestRevision === liveUpdateRevisionRef.current) {
            setErrorResult({
              hostId: selectedHostId,
              hostIdsKey,
              range: queryRangeKey,
              step: effectiveStep,
              aggregation: effectiveAggregation,
              message: 'Unexpected response from the server'
            })
          }

          return
        }

        if (!ignore) {
          if (requestRevision !== liveUpdateRevisionRef.current) {
            // A newer live sample arrived while this request was in flight.
            // Fetch again shortly instead of waiting for the next poll.
            retryTimer = setTimeout(() => {
              retryTimer = null
              fetchMetrics()
            }, 1000)
            return
          }

          setMetricsResult({
            hostId: selectedHostId,
            hostIdsKey,
            range: queryRangeKey,
            step: effectiveStep,
            aggregation: effectiveAggregation,
            data: result.data
          })

          setErrorResult({
            hostId: selectedHostId,
            hostIdsKey,
            range: queryRangeKey,
            step: effectiveStep,
            aggregation: effectiveAggregation,
            message: null
          })
        }
      } catch (err) {
        console.error('Failed to fetch metrics', err)

        if (!ignore && requestRevision === liveUpdateRevisionRef.current) {
          setErrorResult({
            hostId: selectedHostId,
            hostIdsKey,
            range: queryRangeKey,
            step: effectiveStep,
            aggregation: effectiveAggregation,
            message: 'Could not reach the server'
          })
        }
      } finally {
        requestInFlight = false
      }
    }

    if (!pageVisible) return

    fetchMetrics()
    const interval = setInterval(fetchMetrics, pollIntervalMs)

    return () => {
      ignore = true
      clearInterval(interval)
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [
    queryRangeKey,
    queryRangeFrom,
    queryRangeTo,
    selectedHostId,
    effectiveStep,
    effectiveAggregation,
    hostIdsKey,
    metricMode,
    pageVisible,
    pollIntervalMs
  ])

  const metrics = metricsResult.hostId === selectedHostId && metricsResult.hostIdsKey === hostIdsKey && metricsResult.range === queryRangeKey && metricsResult.step === effectiveStep && metricsResult.aggregation === effectiveAggregation
    ? metricsResult.data
    : NO_METRICS

  const primaryMetrics = metrics.filter(row =>
    row.host_id == null
      ? queryHostIds.length === 1
      : String(row.host_id) === String(selectedHostId)
  )
  const error = errorResult.hostId === selectedHostId && errorResult.hostIdsKey === hostIdsKey && errorResult.range === queryRangeKey && errorResult.step === effectiveStep && errorResult.aggregation === effectiveAggregation
    ? errorResult.message
    : null

  const hasCurrentMetricsResult =
    metricsResult.hostId === selectedHostId && metricsResult.hostIdsKey === hostIdsKey &&
    metricsResult.range === queryRangeKey &&
    metricsResult.step === effectiveStep &&
    metricsResult.aggregation === effectiveAggregation

  const isLoading =

    Boolean(selectedHostId) &&

    !hasCurrentMetricsResult &&

    !error


  const isEmpty =

    hasCurrentMetricsResult &&

    !error &&

    metrics.length === 0

  const exportCSV = () => {
    if (!metrics.length) return

    const host = hosts.find(h => h.id === selectedHostId)

    const columns = [
      { key: 'timestamp', header: 'timestamp' },
      { key: 'host_id', header: 'host_id' },
      { key: 'host_name', header: 'host_name' },
      ...selectedMetrics.map(name => ({
        key: name,
        header: formatMetricColumnHeader(name)
      }))
    ]

    const rows = metrics.map(row =>
      columns.map(({ key }) => {
        if (key === 'timestamp') {
          return row.collected_at ?? row.timestamp
        }
        if (key === 'host_id') return row.host_id ?? selectedHostId
        if (key === 'host_name') {
          const rowHost = hosts.find(
            h => String(h.id) === String(row.host_id ?? selectedHostId)
          )
          return rowHost?.name ?? ''
        }
        return row[key]
      })
    )

    const csv = [columns.map(column => column.header), ...rows]
      .map(row => row.map(csvField).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    const baseName = safeFilePart(host?.name ?? ('host_' + selectedHostId))
    const exportName = queryHostIds.length > 1
      ? baseName + '_comparison'
      : baseName

    link.download = exportName + '_' + timeRange + '_' + effectiveStep + '_' + effectiveAggregation + '_metrics.csv'
    link.click()

    window.URL.revokeObjectURL(url)
  }
  return (

    <div>

      <div className="flex flex-col gap-4 mb-8 sm:flex-row sm:justify-between sm:items-center">

        <div>

          <h1 className="text-2xl sm:text-3xl font-bold text-white">
            Metrics Explorer
          </h1>

          <p className="text-gray-400 mt-1">
            {metricMode === 'system' ? 'Explore historical system metrics.' : 'Explore discovered custom metrics.'}
          </p>
          {shouldUseLiveUpdates && LIVE_STATUS_LABELS[liveStatus] && (
  <p
    data-testid="live-status"
    data-status={liveStatus}
    className={`mt-1 text-xs ${
      liveStatus === 'live' ? 'text-emerald-400' : 'text-amber-400'
    }`}
  >
    {LIVE_STATUS_LABELS[liveStatus]}
  </p>
)}

        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">

          <div className="flex rounded-lg border border-gray-700 p-1">
            <button
              type="button"
              onClick={() => setMetricMode('system')}
              aria-pressed={metricMode === 'system'}
              className={`px-3 py-2 rounded-md text-sm font-medium ${metricMode === 'system' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              System
            </button>
            <button
              type="button"
              onClick={() => setMetricMode('custom')}
              aria-pressed={metricMode === 'custom'}
              className={`px-3 py-2 rounded-md text-sm font-medium ${metricMode === 'custom' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Custom
            </button>
          </div>

          <HostSelector
            hosts={hosts}
            selectedHostId={selectedHostId}
            onChange={setSelectedHostId}
          />

          {metricMode === 'system' && (
          <HostComparisonSelector
            hosts={hosts}
            primaryHostId={selectedHostId}
            selectedHostIds={selectedComparisonHostIds}
            onChange={setSelectedComparisonHostIds}
          />
          )}

          {metricMode === 'system' && (
          <button
            onClick={exportCSV}
            disabled={!metrics.length}
            className="
              w-full sm:w-auto bg-emerald-600
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
          )}

        </div>

      </div>

      {metricMode === 'custom' ? (
        <CustomMetricsExplorer
          hostId={selectedHostId}
          hostName={hosts.find(host => String(host.id) === String(selectedHostId))?.name}
        />
      ) : (
        <>
      <MetricSelector
        selectedMetrics={selectedMetrics}
        setSelectedMetrics={setSelectedMetrics}
        timeRange={timeRange}
        setTimeRange={setTimeRange}
        step={effectiveStep}
        setStep={setStep}
        aggregation={effectiveAggregation}
        setAggregation={setAggregation}
        compatibleSteps={compatibleSteps}
        p95Available={p95Available}
        customFrom={customFrom}
        setCustomFrom={setCustomFrom}
        customTo={customTo}
        setCustomTo={setCustomTo}
        customRangeError={customRangeError}
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

      {isLoading ? (
        <MetricsSkeleton />
      ) : isEmpty ? (
        <MetricsEmptyState
          hostName={hosts.find(host => String(host.id) === String(selectedHostId))?.name}
        />
      ) : (
        <>
          {selectedMetrics.map(metricName => (
            <StatsCards
              key={metricName}
              metrics={primaryMetrics}
              selectedMetric={metricName}
              title={
                selectedMetrics.length > 1
                  ? (METRICS[metricName]?.name ?? metricName)
                  : undefined
              }
            />
          ))}

          <MetricsChart
            metrics={metrics}
            selectedMetrics={selectedMetrics}
            timeRange={timeRange}
            primaryHostId={selectedHostId}
            hosts={hosts}
            comparisonHostIds={queryHostIds.slice(1)}
          />

          <MetricsTable
            metrics={metrics}
            selectedMetrics={selectedMetrics}
            hosts={hosts}
            showHost={queryHostIds.length > 1}
          />
        </>
      )}
        </>
      )}

    </div>

  )

}




















