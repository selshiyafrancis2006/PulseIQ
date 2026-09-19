import { useState } from 'react'

const metricOptions = [
  { label: 'CPU Usage', value: 'cpu_usage' },
  { label: 'Memory Usage', value: 'memory_usage' },
  { label: 'Disk Usage', value: 'disk_usage' },
  { label: 'Network In', value: 'network_in' },
  { label: 'Network Out', value: 'network_out' }
]

export default function AddWidgetModal({ hosts, onClose, onAdd }) {

  const [hostId, setHostId] = useState(hosts[0]?.id ?? '')
  const [metric, setMetric] = useState('cpu_usage')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!hostId) return

    onAdd({
      type: 'metric_chart',
      config: {
        host_id: Number(hostId),
        metric
      }
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6 w-full max-w-md">

        <h2 className="text-xl font-bold mb-4">Add Widget</h2>

        <form onSubmit={handleSubmit} className="space-y-4">

          <div>
            <label className="block text-sm text-gray-400 mb-1">Widget type</label>
            <div className="
              bg-[#0f0f0f]
              border border-[#2a2a2a]
              rounded-lg
              px-3 py-2
              text-sm
              text-gray-400
            ">
              Metric Chart
            </div>
          </div>

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
              disabled={!hostId}
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