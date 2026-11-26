import { useEffect, useState } from 'react'
import api from '../services/api'
import useHosts from '../hooks/useHosts'
import HostSelector from '../components/shared/hostSelector'
import ApmRangeSelector from '../components/apm/ApmRangeSelector'
import ApmOverviewCards from '../components/apm/ApmOverviewCards'
import ApmTimeSeriesCharts from '../components/apm/ApmTimeSeriesCharts'
import {
  DEFAULT_APM_RANGE,
  formatMs,
  formatPercent,
  getApmRange
} from '../utils/apm'

function statusColor(status) {
  if (status >= 500) return 'text-red-400'
  if (status >= 400) return 'text-yellow-400'
  return 'text-emerald-400'
}

export default function Apm() {

  const { hosts, selectedHostId, setSelectedHostId } = useHosts()

  const [range, setRange] = useState(DEFAULT_APM_RANGE)

  // Everything the page shows, tagged with the host and range it was loaded
  // for. If the tag does not match the current selection the data is stale
  // (a slow response from before the person switched), so it is not shown.
  const [data, setData] = useState(null)

  const rangeConfig = getApmRange(range)
  const selectionKey = `${selectedHostId}:${range}`
  const ready = data !== null && data.key === selectionKey

  useEffect(() => {

    if (!selectedHostId) {
      return
    }

    let ignore = false
    const key = `${selectedHostId}:${range}`
    const params = { host_id: selectedHostId, range }

    const fetchData = async () => {

      try {

        const [summaryRes, overviewRes, seriesRes, tracesRes] = await Promise.all([
          api.get('/apm/traces/summary', { params }),
          api.get('/apm/traces/overview', { params }),
          api.get('/apm/traces/timeseries', { params }),
          api.get('/apm/traces', { params: { host_id: selectedHostId } })
        ])

        // A response for a host/range that is no longer selected must not
        // overwrite the one that is.
        if (ignore) return

        setData({
          key,
          summary: summaryRes.data,
          overview: overviewRes.data,
          series: seriesRes.data.points,
          traces: tracesRes.data,
          failed: false
        })

      } catch (err) {

        console.error('Failed to fetch APM data:', err)

        if (ignore) return

        // Keep what is already on screen for this selection; only fall back
        // to an empty state when there is nothing to keep.
        setData((previous) =>
          previous && previous.key === key
            ? previous
            : { key, summary: [], overview: null, series: [], traces: [], failed: true }
        )

      }

    }

    fetchData()

    const interval = setInterval(fetchData, getApmRange(range).refreshMs)

    return () => {
      ignore = true
      clearInterval(interval)
    }

  }, [selectedHostId, range])

  const summary = ready ? data.summary : []
  const traces = ready ? data.traces : []

  return (
    <div className="space-y-8 text-white">

      {/* HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">APM</h1>
          <p className="mt-2 text-gray-400">
            Request latency, throughput and error rate, over {rangeConfig.description}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ApmRangeSelector value={range} onChange={setRange} />

          <HostSelector
            hosts={hosts}
            selectedHostId={selectedHostId}
            onChange={setSelectedHostId}
          />
        </div>
      </div>

      {/* OVERVIEW */}
      {ready && <ApmOverviewCards overview={data.overview} />}

      {/* TIME SERIES */}
      {ready && <ApmTimeSeriesCharts points={data.series} range={range} />}

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

        {!ready ? (
          <p className="p-5 text-sm text-gray-500">Loading...</p>
        ) : data.failed ? (
          <p className="p-5 text-sm text-red-400">
            Couldn't load APM data for this host.
          </p>
        ) : summary.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">
            No requests recorded for this host in {rangeConfig.description}. Add the APM
            middleware to an app and point it at this host's API key to see data here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#2a2a2a] text-left text-gray-500 uppercase text-xs tracking-widest">
                  <th className="px-5 py-3">Method</th>
                  <th className="px-5 py-3">Route</th>
                  <th className="px-5 py-3">Requests</th>
                  <th className="px-5 py-3">p50</th>
                  <th className="px-5 py-3">p95</th>
                  <th className="px-5 py-3">p99</th>
                  <th className="px-5 py-3">Max</th>
                  <th className="px-5 py-3">Error rate</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row) => (
                  <tr key={`${row.method}-${row.route}`} className="border-b border-[#2a2a2a] last:border-0">
                    <td className="px-5 py-4 font-mono text-xs text-gray-400">{row.method}</td>
                    <td className="px-5 py-4 font-medium">{row.route}</td>
                    <td className="px-5 py-4 text-gray-400">{row.request_count}</td>
                    <td className="px-5 py-4">{formatMs(row.p50_duration_ms)}</td>
                    <td className="px-5 py-4">{formatMs(row.p95_duration_ms)}</td>
                    <td className="px-5 py-4">{formatMs(row.p99_duration_ms)}</td>
                    <td className="px-5 py-4 text-gray-400">{formatMs(row.max_duration_ms)}</td>
                    <td className={`px-5 py-4 ${Number(row.error_count) > 0 ? 'text-red-400' : 'text-gray-500'}`}>
                      {formatPercent(row.error_rate)}
                      <span className="ml-2 text-xs text-gray-500">
                        ({row.error_count} 5xx)
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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