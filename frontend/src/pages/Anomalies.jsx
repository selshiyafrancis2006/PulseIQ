import { useEffect, useState } from 'react'
import api from '../services/api'
import useHosts from '../hooks/useHosts'
import HostSelector from '../components/shared/hostSelector'

function severityColor(score) {
  const abs = Math.abs(score)
  if (abs >= 6) return 'text-red-400'
  if (abs >= 4) return 'text-yellow-400'
  return 'text-gray-300'
}

export default function Anomalies() {

  const { hosts, selectedHostId, setSelectedHostId } = useHosts()

  const [anomalies, setAnomalies] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {

    if (!selectedHostId) {
      return
    }

    const fetchAnomalies = async () => {

      try {

        const { data } = await api.get('/anomalies', {
          params: { host_id: selectedHostId }
        })

        setAnomalies(data)

      } catch (err) {

        console.error('Failed to fetch anomalies:', err)

      } finally {

        setLoading(false)

      }

    }

    fetchAnomalies()

    const interval = setInterval(fetchAnomalies, 10000)

    return () => clearInterval(interval)

  }, [selectedHostId])

  return (
    <div className="space-y-8 text-white">

      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Anomalies</h1>
          <p className="mt-2 text-gray-400">
            Metric values that deviate significantly from this host's own historical baseline.
          </p>
        </div>

        <HostSelector
          hosts={hosts}
          selectedHostId={selectedHostId}
          onChange={setSelectedHostId}
        />
      </div>

      {/* ANOMALIES LIST */}
      <div className="
        bg-[#1a1a1a]
        border border-[#2a2a2a]
        rounded-xl
        overflow-hidden
      ">

        {loading ? (
          <p className="p-5 text-sm text-gray-500">Loading...</p>
        ) : anomalies.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">
            No anomalies detected for this host. Baselines require at least
            12 hours of history before detection becomes active.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a2a2a] text-left text-gray-500 uppercase text-xs tracking-widest">
                <th className="px-5 py-3">Time</th>
                <th className="px-5 py-3">Metric</th>
                <th className="px-5 py-3">Value</th>
                <th className="px-5 py-3">Baseline (mean ± stddev)</th>
                <th className="px-5 py-3">Deviation</th>
              </tr>
            </thead>
            <tbody>
              {anomalies.map((a) => (
                <tr key={a.id} className="border-b border-[#2a2a2a] last:border-0">
                  <td className="px-5 py-4 text-gray-400">
                    {new Date(a.timestamp).toLocaleString()}
                  </td>
                  <td className="px-5 py-4 font-medium">
                    {a.metric_name.replace(/_/g, ' ')}
                  </td>
                  <td className="px-5 py-4">{parseFloat(a.value).toFixed(1)}</td>
                  <td className="px-5 py-4 text-gray-400">
                    {parseFloat(a.baseline_mean).toFixed(1)} ± {parseFloat(a.baseline_stddev).toFixed(1)}
                  </td>
                  <td className={`px-5 py-4 font-semibold ${severityColor(a.deviation_score)}`}>
                    {parseFloat(a.deviation_score).toFixed(1)}σ
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      </div>

    </div>
  )
}