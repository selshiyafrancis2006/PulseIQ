import { useEffect, useState } from 'react'
import { apiFetch } from '../../utils/apiFetch'
import { API_BASE_URL } from '../../config/api'

export default function MonitorStatusWidget({ monitorId }) {

  const [monitor, setMonitor] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {

    if (!monitorId) return

    const fetchStatus = async () => {
      try {
        const res = await apiFetch(`${API_BASE_URL}/api/monitors/status`)
        const data = await res.json()
        const match = data.find((m) => m.id === monitorId)
        setMonitor(match || null)
      } catch (err) {
        console.error('Widget failed to fetch monitor status:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchStatus()

    const interval = setInterval(fetchStatus, 10000)
    return () => clearInterval(interval)

  }, [monitorId])

  if (loading) {
    return (
      <div className="h-full flex flex-col justify-center items-center p-4 gap-3">
        <div className="h-3 w-24 bg-[#2a2a2a] rounded animate-pulse" />
        <div className="w-4 h-4 rounded-full bg-[#2a2a2a] animate-pulse" />
        <div className="h-4 w-16 bg-[#2a2a2a] rounded animate-pulse" />
      </div>
    )
  }

  if (!monitor) {
    return <div className="h-full flex items-center justify-center text-xs text-gray-600">Monitor not found</div>
  }

  const isUp = monitor.status === 'UP'

  return (
    <div className="h-full flex flex-col justify-center items-center p-4 text-center">

      <p className="text-base text-white mb-3 truncate max-w-full">
        {monitor.name}
      </p>

      <div className={`
        w-4 h-4 rounded-full mb-3
        ${isUp ? 'bg-emerald-500' : 'bg-red-500'}
      `} />

      <p className={`text-lg font-bold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
        {monitor.status || 'UNKNOWN'}
      </p>

      {monitor.response_time_ms != null && (
        <p className="text-xs text-gray-500 mt-2">
          {monitor.response_time_ms} ms
        </p>
      )}

      {monitor.checked_at && (
        <p className="text-xs text-gray-600 mt-1">
          Checked {new Date(monitor.checked_at).toLocaleTimeString()}
        </p>
      )}

    </div>
  )
}