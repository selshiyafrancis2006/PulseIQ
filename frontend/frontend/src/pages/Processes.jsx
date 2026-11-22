import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../utils/apiFetch'
import { API_BASE_URL } from '../config/api'
import useHosts from '../hooks/useHosts'
import HostSelector from '../components/shared/hostSelector'

const REFRESH_INTERVAL_MS = 10000

// Stable reference, so "no processes yet" doesn't change on every render
const NO_PROCESSES = []

// Agents send a new list every 30 seconds by default; past this the host has
// probably stopped reporting.
const STALE_AFTER_MS = 2 * 60 * 1000

export default function Processes() {

  const { hosts, selectedHostId, setSelectedHostId, loading: hostsLoading } = useHosts()

  const [processes, setProcesses] = useState([])
  const [collectedAt, setCollectedAt] = useState(null)
  const [loadedHostId, setLoadedHostId] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('cpu')
  const [status, setStatus] = useState('all')

  useEffect(() => {

    if (!selectedHostId) return

    let ignore = false

    const fetchProcesses = async () => {

      try {
        const res = await apiFetch(
          `${API_BASE_URL}/api/hosts/${selectedHostId}/processes`
        )

        if (!res.ok) {
          throw new Error(`Request failed (${res.status})`)
        }

        const data = await res.json()

        if (ignore) return

        setProcesses(Array.isArray(data.processes) ? data.processes : [])
        setCollectedAt(data.collected_at ? new Date(data.collected_at) : null)
        setLoadedHostId(selectedHostId)
        setError('')
      }
      catch (err) {
        if (ignore) return

        console.error(err)
        setError('Could not load processes. Retrying\u2026')
      }

    }

    fetchProcesses()

    const interval = setInterval(fetchProcesses, REFRESH_INTERVAL_MS)

    return () => {
      ignore = true
      clearInterval(interval)
    }

  }, [selectedHostId])

  // Never show the previous host's processes under a newly selected host
  const hasLoadedSelectedHost = loadedHostId === selectedHostId
  const visibleProcesses = hasLoadedSelectedHost ? processes : NO_PROCESSES
  const visibleCollectedAt = hasLoadedSelectedHost ? collectedAt : null

  const isStale = visibleCollectedAt !== null &&
    Date.now() - visibleCollectedAt.getTime() > STALE_AFTER_MS

  const filteredProcesses = useMemo(() => {

    let data = [...visibleProcesses]

    if (search) {
  data = data.filter(process =>
    process.name.toLowerCase().includes(search.toLowerCase()) ||
    process.pid.toString().includes(search)
  )
}

    if (status !== 'all') {
      data = data.filter(process =>
        process.status === status
      )
    }

    data.sort((a, b) => {
      if (sortBy === 'cpu')
        return b.cpu - a.cpu

      return b.memory - a.memory
    })

    return data

  }, [visibleProcesses, search, sortBy, status])

  const highestCpuPid = visibleProcesses.length
  ? visibleProcesses.reduce((max, p) =>
      (p.cpu ?? 0) > (max.cpu ?? 0) ? p : max
    ).pid
  : null;

  const maxMemory = Math.max(
  ...visibleProcesses.map(process => process.memory ?? 0),
  1
);

  return (

    <div>

      {/* HEADER */}
      <div className="flex justify-between items-center mb-8">

        <div>
          <h1 className="text-3xl font-bold text-white">
            Process Monitor
          </h1>

          <p className="text-gray-400 mt-1">
            The busiest processes on the selected host, as reported by its agent.
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <HostSelector
            hosts={hosts}
            selectedHostId={selectedHostId}
            onChange={setSelectedHostId}
          />

          {visibleCollectedAt && (
            <div
              data-testid="processes-updated"
              className={`text-sm ${isStale ? 'text-amber-400' : 'text-emerald-400'}`}
            >
              {isStale ? '● Last reported ' : '● Reported '}
              {visibleCollectedAt.toLocaleTimeString()}
            </div>
          )}
        </div>

      </div>

      {error && (
        <div role="alert" className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          {error}
        </div>
      )}

      {!hostsLoading && hosts.length === 0 && (
        <div className="mb-6 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-6 text-center text-gray-400">
          No hosts yet. Register a host and start its agent to see its processes.
        </div>
      )}

      {hosts.length > 0 && hasLoadedSelectedHost && visibleCollectedAt === null && (
        <div className="mb-6 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-6 text-center text-gray-400">
          This host has not reported any processes yet. Update its agent and
          make sure PROCESS_INTERVAL_MS is not set to 0.
        </div>
      )}

      {isStale && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          This list is more than 2 minutes old. The host's agent may be offline.
        </div>
      )}

      {/* SUMMARY */}
<div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">

  <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5">
    <p className="text-sm text-gray-400">
      Total Processes
    </p>

    <p className="text-3xl font-bold text-emerald-400 mt-2">
      {visibleProcesses.length}
    </p>
  </div>

  <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5">
    <p className="text-sm text-gray-400">
      Running
    </p>

    <p className="text-3xl font-bold text-emerald-400 mt-2">
      {
        visibleProcesses.filter(
          process => process.status === 'Running'
        ).length
      }
    </p>
  </div>

 <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5">
  <p className="text-sm text-gray-400">
    Highest Memory
  </p>

  <p className="text-3xl font-bold text-emerald-400 mt-2">
    {visibleProcesses.length
      ? `${Math.max(...visibleProcesses.map(p => p.memory ?? 0))} MB`
      : '0 MB'}
  </p>

  <p className="text-xs text-gray-500 mt-1">
    {visibleProcesses.length
      ? visibleProcesses.reduce((max, p) =>
          (p.memory ?? 0) > (max.memory ?? 0) ? p : max
        ).name
      : '--'}
  </p>
</div>

  <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5">
  <p className="text-sm text-gray-400">
    Highest CPU
  </p>

  <p className="text-3xl font-bold text-emerald-400 mt-2">
    {visibleProcesses.length
      ? `${Math.max(...visibleProcesses.map(p => p.cpu ?? 0)).toFixed(1)}%`
      : '0%'}
  </p>

  <p className="text-xs text-gray-500 mt-1">
    {visibleProcesses.length
      ? visibleProcesses.reduce((max, p) =>
          (p.cpu ?? 0) > (max.cpu ?? 0) ? p : max
        ).name
      : '--'}
  </p>
</div>

</div>

      {/* CONTROLS */}
      <div className="grid md:grid-cols-3 gap-4 mb-8">

        <input
          placeholder="Search PID or Process..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-2 outline-none focus:border-emerald-400"
        />

        <select
  value={status}
  onChange={(e) => setStatus(e.target.value)}
  className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-2"
>
  <option value="all">All Status</option>
  <option value="Running">Running</option>
  <option value="Idle">Idle</option>
  <option value="Sleeping">Sleeping</option>
</select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-2"
        >
          <option value="cpu">Sort by CPU</option>
          <option value="memory">Sort by Memory</option>
        </select>

      </div>

      {/* TABLE */}
      <div className="bg-[#1a1a1a] rounded-xl border border-[#2a2a2a] overflow-hidden">
  <div className="max-h-[600px] overflow-y-auto">

        <table className="w-full">

          <thead className="sticky top-0 bg-[#1a1a1a] z-10">
            <tr className="border-b border-[#2a2a2a]">
              <th className="text-left p-4">Process</th>
              <th
  onClick={() => setSortBy('cpu')}
  className="text-left p-4 cursor-pointer hover:text-emerald-400 transition-colors"
>
  CPU %
  {sortBy === 'cpu' && (
    <span className="ml-1 text-emerald-400">▲</span>
  )}
</th>

<th
  onClick={() => setSortBy('memory')}
  className="text-left p-4 cursor-pointer hover:text-emerald-400 transition-colors"
>
  Memory
  {sortBy === 'memory' && (
    <span className="ml-1 text-emerald-400">▲</span>
  )}
</th>
              <th className="text-left p-4">Status</th>
              <th className="text-left p-4">Last Updated</th>
            </tr>
          </thead>

          <tbody>
  {filteredProcesses.map((process) => (
    <tr
      key={process.pid}
      className={`border-b border-[#2a2a2a] hover:bg-[#202020] transition-colors ${
        process.pid === highestCpuPid
          ? "bg-emerald-400/5"
          : ""
      }`}
    >
      {/* Process */}
      <td className="p-4">
        <div className="font-medium text-white">
          {process.name}
        </div>

        <div className="text-xs text-gray-500 mt-1">
          PID: {process.pid}
        </div>
      </td>

      {/* CPU */}
      <td className="p-4 min-w-[180px]">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-emerald-400">
            {(process.cpu ?? 0).toFixed(2)}%
          </span>
        </div>

        <div className="w-full h-2 bg-[#2a2a2a] rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-400 rounded-full"
            style={{
              width: `${Math.min(process.cpu ?? 0, 100)}%`,
            }}
          />
        </div>
      </td>

      {/* Memory */}
      <td className="p-4 min-w-[180px]">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-emerald-400">
            {process.memory ?? 0} MB
          </span>
        </div>

        <div className="w-full h-2 bg-[#2a2a2a] rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-400 rounded-full"
            style={{
              width: `${((process.memory ?? 0) / maxMemory) * 100}%`,
            }}
          />
        </div>
      </td>

      {/* Status */}
      <td className="p-4">
        <span className="px-3 py-1 rounded-full bg-emerald-400/10 text-emerald-400 text-xs font-medium">
          {process.status}
        </span>
      </td>

      {/* Last Updated */}
      <td className="p-4 text-gray-400">
        {visibleCollectedAt
          ? visibleCollectedAt.toLocaleTimeString()
          : "--"}
      </td>
    </tr>
  ))}
</tbody>
        </table>

        <div className="flex justify-between items-center px-4 py-3 border-t border-[#2a2a2a] text-sm text-gray-400">

  <span>
    Showing {filteredProcesses.length} of {visibleProcesses.length} processes
  </span>

  <span>
    Refreshes every 10 seconds; the agent reports about every 30 seconds
  </span>

</div>

      </div>

    </div>
    </div>

  )
}