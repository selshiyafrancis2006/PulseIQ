import { useEffect, useState } from 'react'
import { apiFetch } from '../utils/apiFetch'
import { API_BASE_URL } from '../config/api'

const REFRESH_MS = 30000
const NO_EVENTS = { alerts: [], anomalies: [] }

// Recent alerts and anomalies of one host, for marking them on the chart.
export default function useChartEvents(hostId) {
  const [state, setState] = useState({ hostId: null, ...NO_EVENTS })

  useEffect(() => {
    if (!hostId) return

    let ignore = false

    const load = async () => {
      try {
        const id = encodeURIComponent(hostId)
        const [alertsRes, anomaliesRes] = await Promise.all([
          apiFetch(`${API_BASE_URL}/api/alerts?host_id=${id}&limit=100`),
          apiFetch(`${API_BASE_URL}/api/anomalies?host_id=${id}`)
        ])

        const alerts = alertsRes.ok ? await alertsRes.json() : []
        const anomalies = anomaliesRes.ok ? await anomaliesRes.json() : []

        if (ignore) return

        setState({
          hostId: String(hostId),
          alerts: Array.isArray(alerts) ? alerts : [],
          anomalies: Array.isArray(anomalies) ? anomalies : []
        })
      } catch (err) {
        console.error('Failed to load alerts and anomalies for the chart:', err)
      }
    }

    load()
    const timer = setInterval(load, REFRESH_MS)

    return () => {
      ignore = true
      clearInterval(timer)
    }
  }, [hostId])

  return String(hostId) === state.hostId ? state : NO_EVENTS
}
