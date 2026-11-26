import { useEffect, useState } from 'react'
import api from '../../services/api'
import { getApmRange, statusColor } from '../../utils/apm'
import ApmOverviewCards from './ApmOverviewCards'
import ApmTimeSeriesCharts from './ApmTimeSeriesCharts'
import ApmRequestsTable from './ApmRequestsTable'

// Drill-down for one method + route: its own stats, status codes, charts and
// requests.
export default function ApmRouteDetail({ hostId, method, route, range, onClose }) {

  const [data, setData] = useState(null)

  const key = `${hostId}:${method}:${route}:${range}`
  const ready = data !== null && data.key === key
  const rangeConfig = getApmRange(range)

  useEffect(() => {

    let ignore = false
    const params = { host_id: hostId, method, route, range }

    const load = async () => {

      try {

        const res = await api.get('/apm/routes/detail', { params })

        if (ignore) return

        setData({ key, detail: res.data, failed: false })

      } catch (err) {

        console.error('Failed to fetch APM route detail:', err)

        if (ignore) return

        setData((previous) =>
          previous && previous.key === key
            ? previous
            : { key, detail: null, failed: true }
        )

      }

    }

    load()

    const interval = setInterval(load, rangeConfig.refreshMs)

    return () => {
      ignore = true
      clearInterval(interval)
    }

  }, [hostId, method, route, range, key, rangeConfig.refreshMs])

  const detail = ready ? data.detail : null

  return (
    <div className="space-y-8">

      <div>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-gray-400 hover:text-white"
        >
          â† All routes
        </button>

        <h2 className="mt-3 text-2xl font-bold">
          <span className="font-mono text-base text-gray-400 mr-3">{method}</span>
          {route}
        </h2>

        <p className="mt-1 text-sm text-gray-400">
          Over {rangeConfig.description}.
        </p>
      </div>

      {!ready ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : data.failed ? (
        <p className="text-sm text-red-400">Couldn't load this route.</p>
      ) : (
        <>
          <ApmOverviewCards overview={detail} />

          {detail.status_codes.length > 0 && (
            <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-5 py-4">
              <h3 className="text-sm uppercase tracking-widest text-gray-500 mb-3">
                Status codes
              </h3>

              <ul className="flex flex-wrap gap-3">
                {detail.status_codes.map((entry) => (
                  <li
                    key={String(entry.status_code)}
                    className="rounded-md border border-[#2a2a2a] px-3 py-1.5 text-sm"
                  >
                    <span className={`font-semibold ${statusColor(entry.status_code)}`}>
                      {entry.status_code ?? 'No status'}
                    </span>
                    <span className="ml-2 text-gray-400">
                      {entry.request_count.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ApmTimeSeriesCharts points={detail.points} range={range} />
        </>
      )}

      <ApmRequestsTable
        hostId={hostId}
        range={range}
        fixedMethod={method}
        fixedRoute={route}
        title="Requests for this route"
      />

    </div>
  )
}