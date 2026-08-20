import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../utils/apiFetch'
import { API_BASE_URL } from '../config/api'

export default function Processes() {

  const [processes, setProcesses] = useState([])
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('cpu')
  const [status, setStatus] = useState('all')
  const [lastUpdated, setLastUpdated] = useState(null)

  useEffect(() => {

    const fetchProcesses = async () => {

      try {
        const res = await apiFetch(`${API_BASE_URL}/api/processes`)
        const data = await res.json()
        setProcesses(data)
        setLastUpdated(new Date())
      }
      catch (err) {
        console.error(err)
      }

    }

    fetchProcesses()

    const interval = setInterval(fetchProcesses, 5000)
    return () => clearInterval(interval)

  }, [])

  const filteredProcesses = useMemo(() => {

    let data = [...processes]

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

  }, [processes, search, sortBy, status])

  const highestCpuPid = processes.length
  ? processes.reduce((max, p) =>
      (p.cpu ?? 0) > (max.cpu ?? 0) ? p : max
    ).pid
  : null;

  const maxMemory = Math.max(
  ...processes.map(process => process.memory ?? 0),
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
            Monitor running processes in real time.
          </p>
        </div>

        <div className="text-emerald-400 text-sm">
          ● Live
        </div>

      </div>

      {/* SUMMARY */}
<div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">

  <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5">
    <p className="text-sm text-gray-400">
      Total Processes
    </p>

    <p className="text-3xl font-bold text-emerald-400 mt-2">
      {processes.length}
    </p>
  </div>

  <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5">
    <p className="text-sm text-gray-400">
      Running
    </p>

    <p className="text-3xl font-bold text-emerald-400 mt-2">
      {
        processes.filter(
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
    {processes.length
      ? `${Math.max(...processes.map(p => p.memory ?? 0))} MB`
      : '0 MB'}
  </p>

  <p className="text-xs text-gray-500 mt-1">
    {processes.length
      ? processes.reduce((max, p) =>
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
    {processes.length
      ? `${Math.max(...processes.map(p => p.cpu ?? 0)).toFixed(1)}%`
      : '0%'}
  </p>

  <p className="text-xs text-gray-500 mt-1">
    {processes.length
      ? processes.reduce((max, p) =>
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
        {lastUpdated
          ? lastUpdated.toLocaleTimeString()
          : "--"}
      </td>
    </tr>
  ))}
</tbody>
        </table>

        <div className="flex justify-between items-center px-4 py-3 border-t border-[#2a2a2a] text-sm text-gray-400">

  <span>
    Showing {filteredProcesses.length} of {processes.length} processes
  </span>

  <span>
    Auto refresh every 5 seconds
  </span>

</div>

      </div>

    </div>
    </div>

  )
}