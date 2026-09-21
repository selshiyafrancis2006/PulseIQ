import { useEffect, useState } from 'react'
import { apiFetch } from '../../utils/apiFetch'
import { API_BASE_URL } from '../../config/api'

const rangeToMs = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000
}

export default function LogCountWidget({ severity, timeRange }) {

  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {

    const fetchLogs = async () => {
      try {
        const res = await apiFetch(`${API_BASE_URL}/api/logs`)
        const data = await res.json()

        const windowMs = rangeToMs[timeRange] || rangeToMs['1h']
        const cutoff = Date.now() - windowMs

        const matching = data.filter((log) => {
          const inWindow = new Date(log.created_at).getTime() >= cutoff
          const matchesSeverity = severity === 'ALL' || log.level === severity
          return inWindow && matchesSeverity
        })

        setCount(matching.length)
      } catch (err) {
        console.error('Widget failed to fetch logs:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchLogs()

    const interval = setInterval(fetchLogs, 15000)
    return () => clearInterval(interval)

  }, [severity, timeRange])

  const severityColor = {
    ERROR: 'text-red-400',
    WARN: 'text-yellow-400',
    INFO: 'text-emerald-400',
    ALL: 'text-white'
  }[severity] || 'text-white'

  return (
    <div className="h-full flex flex-col justify-center items-center p-4 text-center">
      <p className="text-sm text-white mb-2">
        {severity === 'ALL' ? 'All Logs' : `${severity} Logs`}
      </p>
      {loading ? (
        <div className="h-10 w-16 bg-[#2a2a2a] rounded animate-pulse" />
      ) : (
        <p className={`text-4xl font-bold ${severityColor}`}>
          {count}
        </p>
      )}
    </div>
  )
}