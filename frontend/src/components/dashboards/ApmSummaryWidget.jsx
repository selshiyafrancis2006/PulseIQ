import { useEffect, useState } from 'react'
import { apiFetch } from '../../utils/apiFetch'
import { API_BASE_URL } from '../../config/api'

export default function ApmSummaryWidget({ hostId }) {

  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {

    if (!hostId) return

    const fetchSummary = async () => {
      try {
        const res = await apiFetch(
          `${API_BASE_URL}/api/apm/traces/overview?host_id=${hostId}`
        )

        if (!res.ok) {
          throw new Error(`APM overview request failed: ${res.status}`)
        }

        const data = await res.json()

        setSummary({
          totalRequests: Number(data.request_count),
          p95: data.p95_duration_ms === null ? null : Number(data.p95_duration_ms),
          errorRate: data.error_rate === null ? null : Number(data.error_rate),
          totalErrors: Number(data.error_count)
        })
      } catch (err) {
        console.error('Widget failed to fetch APM summary:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchSummary()

    const interval = setInterval(fetchSummary, 15000)
    return () => clearInterval(interval)

  }, [hostId])

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
    return <div className="h-full flex items-center justify-center text-xs text-gray-600">No data yet</div>
  }

  return (
    <div className="h-full flex items-center justify-around p-4 text-center">

      <div>
        <p className="text-2xl font-bold text-white">{summary.totalRequests}</p>
        <p className="text-xs text-gray-500 mt-1">Requests</p>
      </div>

      <div>
        <p className="text-2xl font-bold text-emerald-400">
          {summary.p95 === null ? 'â€”' : `${summary.p95.toFixed(0)}ms`}
        </p>
        <p className="text-xs text-gray-500 mt-1">p95</p>
      </div>

      <div>
        <p className={`text-2xl font-bold ${summary.totalErrors > 0 ? 'text-red-400' : 'text-white'}`}>
          {summary.errorRate === null ? 'â€”' : `${summary.errorRate.toFixed(1)}%`}
        </p>
        <p className="text-xs text-gray-500 mt-1">Error rate</p>
      </div>

    </div>
  )
}