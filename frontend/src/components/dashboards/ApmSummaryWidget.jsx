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
          `${API_BASE_URL}/api/apm/traces/summary?host_id=${hostId}`
        )
        const data = await res.json()

        const totalRequests = data.reduce((sum, r) => sum + Number(r.request_count), 0)
        const totalErrors = data.reduce((sum, r) => sum + Number(r.error_count), 0)
        const weightedDuration = data.reduce(
          (sum, r) => sum + Number(r.avg_duration_ms) * Number(r.request_count),
          0
        )
        const avgDuration = totalRequests > 0 ? weightedDuration / totalRequests : 0

        setSummary({ totalRequests, totalErrors, avgDuration })
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
  )
}