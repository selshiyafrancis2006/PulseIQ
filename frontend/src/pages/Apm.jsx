import { useEffect, useState } from 'react'
import api from '../services/api'
import useHosts from '../hooks/useHosts'
import HostSelector from '../components/shared/hostSelector'

function statusColor(status) {
  if (status >= 500) return 'text-red-400'
  if (status >= 400) return 'text-yellow-400'
  return 'text-emerald-400'
}

export default function Apm() {

  const { hosts, selectedHostId, setSelectedHostId } = useHosts()

  const [summary, setSummary] = useState([])
  const [traces, setTraces] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {

    if (!selectedHostId) {
      return
    }

    const fetchData = async () => {

      try {

        const [summaryRes, tracesRes] = await Promise.all([
          api.get('/apm/traces/summary', { params: { host_id: selectedHostId } }),
          api.get('/apm/traces', { params: { host_id: selectedHostId } })
        ])

        setSummary(summaryRes.data)
        setTraces(tracesRes.data)

      } catch (err) {

        console.error('Failed to fetch APM data:', err)

      } finally {

        setLoading(false)

      }

    }

    fetchData()

    const interval = setInterval(fetchData, 5000)

    return () => clearInterval(interval)

  }, [selectedHostId])

  return (
    <div className="space-y-8 text-white">

      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">APM</h1>
          <p className="mt-2 text-gray-400">
            Request latency and error rate by route, over the last hour.
          </p>
        </div>

        <HostSelector
          hosts={hosts}
          selectedHostId={selectedHostId}
          onChange={setSelectedHostId}
        />
      </div>

      {/* ROUTE SUMMARY */}
      <div className="
        bg-[#1a1a1a]
        border border-[#2a2a2a]
        rounded-xl
        overflow-hidden
      ">

        <h2 className="px-5 py-4 text-lg font-semibold border-b border-[#2a2a2a]">
          Routes
        </h2>

        {loading ? (
          <p className="p-5 text-sm text-gray-500">Loading...</p>
        ) : summary.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">
            No requests recorded for this host in the last hour. Add the APM
            middleware to an app and point it at this host's API key to see data here.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a2a2a] text-left text-gray-500 uppercase text-xs tracking-widest">
                <th className="px-5 py-3">Method</th>
                <th className="px-5 py-3">Route</th>
                <th className="px-5 py-3">Requests</th>
                <th className="px-5 py-3">Avg Duration</th>
                <th className="px-5 py-3">Max Duration</th>
                <th className="px-5 py-3">Errors</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => (
                <tr key={`${row.method}-${row.route}`} className="border-b border-[#2a2a2a] last:border-0">
                  <td className="px-5 py-4 font-mono text-xs text-gray-400">{row.method}</td>
                  <td className="px-5 py-4 font-medium">{row.route}</td>
                  <td className="px-5 py-4 text-gray-400">{row.request_count}</td>
                  <td className="px-5 py-4">{row.avg_duration_ms} ms</td>
                  <td className="px-5 py-4 text-gray-400">{row.max_duration_ms} ms</td>
                  <td className={`px-5 py-4 ${Number(row.error_count) > 0 ? 'text-red-400' : 'text-gray-500'}`}>
                    {row.error_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      </div>

      {/* RECENT TRACES */}
      <div className="
        bg-[#1a1a1a]
        border border-[#2a2a2a]
        rounded-xl
        overflow-hidden
      ">

        <h2 className="px-5 py-4 text-lg font-semibold border-b border-[#2a2a2a]">
          Recent Requests
        </h2>

        {traces.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">No recent requests.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a2a2a] text-left text-gray-500 uppercase text-xs tracking-widest">
                <th className="px-5 py-3">Time</th>
                <th className="px-5 py-3">Method</th>
                <th className="px-5 py-3">Route</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Duration</th>
              </tr>
            </thead>
            <tbody>
              {traces.map((trace) => (
                <tr key={trace.id} className="border-b border-[#2a2a2a] last:border-0">
                  <td className="px-5 py-4 text-gray-400">
                    {new Date(trace.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="px-5 py-4 font-mono text-xs text-gray-400">{trace.method}</td>
                  <td className="px-5 py-4 font-medium">{trace.route}</td>
                  <td className={`px-5 py-4 font-semibold ${statusColor(trace.status_code)}`}>
                    {trace.status_code}
                  </td>
                  <td className="px-5 py-4 text-gray-400">{trace.duration_ms} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      </div>

    </div>
  )
}