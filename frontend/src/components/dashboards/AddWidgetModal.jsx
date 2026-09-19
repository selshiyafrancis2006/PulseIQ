import { useEffect, useState } from 'react'
import { apiFetch } from '../../utils/apiFetch'
import { API_BASE_URL } from '../../config/api'

const metricOptions = [
  { label: 'CPU Usage', value: 'cpu_usage' },
  { label: 'Memory Usage', value: 'memory_usage' },
  { label: 'Disk Usage', value: 'disk_usage' },
  { label: 'Network In', value: 'network_in' },
  { label: 'Network Out', value: 'network_out' }
]

export default function AddWidgetModal({ hosts, onClose, onAdd }) {

  const [widgetType, setWidgetType] = useState('metric_chart')

  const [hostId, setHostId] = useState(hosts[0]?.id ?? '')
  const [metric, setMetric] = useState('cpu_usage')

  const [monitors, setMonitors] = useState([])
  const [monitorId, setMonitorId] = useState('')

  useEffect(() => {

    const fetchMonitors = async () => {
      try {
        const res = await apiFetch(`${API_BASE_URL}/api/monitors`)
        const data = await res.json()
        setMonitors(data)
        if (data.length > 0) setMonitorId(data[0].id)
      } catch (err) {
        console.error('Failed to fetch monitors:', err)
      }
    }

    fetchMonitors()

  }, [])

  const handleSubmit = (e) => {
    e.preventDefault()

    if (widgetType === 'metric_chart') {
      if (!hostId) return
      const metricLabel = metricOptions.find((m) => m.value === metric)?.label || metric
      const selectedHost = hosts.find((h) => h.id === Number(hostId))
      onAdd({
        type: 'metric_chart',
        config: { host_id: Number(hostId), metric },
        title: `${metricLabel} · ${selectedHost?.name || 'Host'}`
      })
    } else if (widgetType === 'monitor_status') {
      if (!monitorId) return
      const selectedMonitor = monitors.find((m) => m.id === Number(monitorId))
      onAdd({
        type: 'monitor_status',
        config: { monitor_id: Number(monitorId) },
        title: selectedMonitor?.name || 'Monitor'
      })
    }
  }

  const canSubmit =
    widgetType === 'metric_chart' ? !!hostId : !!monitorId

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6 w-full max-w-md">

        <h2 className="text-xl font-bold mb-4">Add Widget</h2>

        <form onSubmit={handleSubmit} className="space-y-4">

          <div>
            <label className="block text-sm text-gray-400 mb-1">Widget type</label>
            <select
              value={widgetType}
              onChange={(e) => setWidgetType(e.target.value)}
              className="
                w-full
                bg-[#0f0f0f]
                border border-[#2a2a2a]
                rounded-lg
                px-3 py-2
                text-sm
                outline-none
                focus:border-emerald-500
              "
            >
              <option value="metric_chart">Metric Chart</option>
              <option value="monitor_status">Monitor Status</option>
            </select>
          </div>

          {widgetType === 'metric_chart' && (
            <>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Host</label>
                <select
                  value={hostId}
                  onChange={(e) => setHostId(e.target.value)}
                  className="
                    w-full
                    bg-[#0f0f0f]
                    border border-[#2a2a2a]
                    rounded-lg
                    px-3 py-2
                    text-sm
                    outline-none
                    focus:border-emerald-500
                  "
                >
                  {hosts.map((host) => (
                    <option key={host.id} value={host.id}>
                      {host.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Metric</label>
                <select
                  value={metric}
                  onChange={(e) => setMetric(e.target.value)}
                  className="
                    w-full
                    bg-[#0f0f0f]
                    border border-[#2a2a2a]
                    rounded-lg
                    px-3 py-2
                    text-sm
                    outline-none
                    focus:border-emerald-500
                  "
                >
                  {metricOptions.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {widgetType === 'monitor_status' && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Monitor</label>
              {monitors.length === 0 ? (
                <p className="text-xs text-gray-600">
                  No monitors found. Create one on the Uptime Monitoring page first.
                </p>
              ) : (
                <select
                  value={monitorId}
                  onChange={(e) => setMonitorId(e.target.value)}
                  className="
                    w-full
                    bg-[#0f0f0f]
                    border border-[#2a2a2a]
                    rounded-lg
                    px-3 py-2
                    text-sm
                    outline-none
                    focus:border-emerald-500
                  "
                >
                  {monitors.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="
                px-4 py-2
                rounded-lg
                bg-emerald-600
                hover:bg-emerald-500
                disabled:opacity-50
                text-sm
                font-semibold
              "
            >
              Add Widget
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}