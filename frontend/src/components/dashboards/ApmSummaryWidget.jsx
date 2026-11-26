import usePolledResource from '../../hooks/usePolledResource'
import { apiFetch } from '../../utils/apiFetch'
import { API_BASE_URL } from '../../config/api'

const POLL_INTERVAL_MS = 15000

const RANGE_LABELS = {
  '15m': 'Last 15 minutes',
  '1h': 'Last hour',
  '6h': 'Last 6 hours',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days'
}

function summarize(routes) {
  const totalRequests = routes.reduce((sum, route) => sum + Number(route.request_count || 0), 0)
  const totalErrors = routes.reduce((sum, route) => sum + Number(route.error_count || 0), 0)
  const weightedDuration = routes.reduce(
    (sum, route) => sum + Number(route.avg_duration_ms || 0) * Number(route.request_count || 0),
    0
  )

  return {
    totalRequests,
    totalErrors,
    avgDuration: totalRequests > 0 ? weightedDuration / totalRequests : 0
  }
}

async function fetchSummary(hostId, range, signal) {
  const params = new URLSearchParams({
    host_id: String(hostId),
    range
  })

  const response = await apiFetch(
    `${API_BASE_URL}/api/apm/traces/summary?${params}`,
    { signal }
  )

  if (!response.ok) {
    let message = `Request failed (${response.status})`

    try {
      const body = await response.json()
      if (body?.error) message = body.error
    } catch {
      // Keep the status-based message.
    }

    throw new Error(message)
  }

  const routes = await response.json()

  if (!Array.isArray(routes)) {
    throw new Error('Unexpected response from APM summary endpoint')
  }

  return summarize(routes)
}

export default function ApmSummaryWidget({ hostId, timeRange = '1h' }) {
  const range = RANGE_LABELS[timeRange] ? timeRange : '1h'

  const { data: summary, loading, error } = usePolledResource(
    (signal) => fetchSummary(hostId, range, signal),
    {
      key: `${hostId}:${range}`,
      enabled: Boolean(hostId),
      intervalMs: POLL_INTERVAL_MS
    }
  )

  if (!hostId) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-gray-600">
        No host selected
      </div>
    )
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center gap-4 p-4">
        <div className="h-10 w-14 bg-[#2a2a2a] rounded animate-pulse" />
        <div className="h-10 w-14 bg-[#2a2a2a] rounded animate-pulse" />
        <div className="h-10 w-14 bg-[#2a2a2a] rounded animate-pulse" />
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="h-full flex items-center justify-center p-4 text-center text-xs text-red-400">
        {error ? `Couldn't load APM data: ${error}` : 'No data yet'}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col justify-center p-4">
      <div className="flex items-center justify-around text-center">
        <div>
          <p className="text-2xl font-bold text-white">{summary.totalRequests}</p>
          <p className="text-xs text-gray-500 mt-1">Requests</p>
        </div>

        <div>
          <p className="text-2xl font-bold text-emerald-400">
            {summary.avgDuration.toFixed(0)}ms
          </p>
          <p className="text-xs text-gray-500 mt-1">Avg Time</p>
        </div>

        <div>
          <p className={`text-2xl font-bold ${summary.totalErrors > 0 ? 'text-red-400' : 'text-white'}`}>
            {summary.totalErrors}
          </p>
          <p className="text-xs text-gray-500 mt-1">Errors</p>
        </div>
      </div>

      <p className="mt-3 text-center text-[10px] text-gray-600">
        {RANGE_LABELS[range]}
        {error && <span className="text-yellow-500"> · update failed, showing last data</span>}
      </p>
    </div>
  )
}
