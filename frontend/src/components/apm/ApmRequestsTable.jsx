import { useEffect, useMemo, useState } from 'react'
import api from '../../services/api'
import { formatMs, getApmRange, statusColor } from '../../utils/apm'

const PAGE_SIZE = 25

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

const STATUS_OPTIONS = [
  ['', 'All statuses'],
  ['2xx', '2xx success'],
  ['3xx', '3xx redirect'],
  ['4xx', '4xx client error'],
  ['5xx', '5xx server error'],
  ['error', 'Any error (4xx + 5xx)']
]

const INITIAL_FILTERS = {
  method: '',
  status: '',
  route: '',
  minDuration: '',
  sort: 'timestamp',
  order: 'desc',
  page: 1
}

// One-click views over the same filters
const PRESETS = [
  { id: 'latest', label: 'Latest', patch: { sort: 'timestamp', order: 'desc', status: '' } },
  { id: 'slowest', label: 'Slowest', patch: { sort: 'duration', order: 'desc', status: '' } },
  { id: 'failing', label: 'Failing', patch: { sort: 'timestamp', order: 'desc', status: '5xx' } }
]

const presetActive = (filters, preset) =>
  Object.entries(preset.patch).every(([key, value]) => filters[key] === value)

const inputClass = `
  rounded-md border border-[#2a2a2a] bg-[#111] px-3 py-1.5 text-sm text-white
  placeholder-gray-600 focus:outline-none focus:border-gray-500
`

function SortHeader({ column, label, filters, onSort }) {

  const active = filters.sort === column
  const ariaSort = active
    ? (filters.order === 'asc' ? 'ascending' : 'descending')
    : 'none'

  return (
    <th className="px-5 py-3" aria-sort={ariaSort}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`uppercase text-xs tracking-widest ${active ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
      >
        {label}{active ? (filters.order === 'asc' ? ' â†‘' : ' â†“') : ''}
      </button>
    </th>
  )
}

// A page of requests with filters, sorting and pagination. In the route
// drill-down, fixedMethod/fixedRoute pin it to one route.
export default function ApmRequestsTable({
  hostId,
  range,
  fixedMethod = '',
  fixedRoute = '',
  title = 'Requests'
}) {

  const [filters, setFilters] = useState(INITIAL_FILTERS)
  const [draft, setDraft] = useState({ route: '', minDuration: '' })
  const [data, setData] = useState(null)

  const pinned = Boolean(fixedRoute)

  // Anything that changes what is shown goes back to the first page
  const update = (patch) => setFilters((current) => ({ ...current, ...patch, page: 1 }))

  const params = useMemo(() => {

    const method = pinned ? fixedMethod : filters.method
    const route = pinned ? fixedRoute : filters.route

    const built = {
      host_id: hostId,
      range,
      page: filters.page,
      page_size: PAGE_SIZE,
      sort: filters.sort,
      order: filters.order
    }

    if (method) built.method = method
    if (route) built.route = route
    if (filters.status) built.status = filters.status
    if (filters.minDuration !== '') built.min_duration_ms = filters.minDuration

    return built

  }, [hostId, range, filters, pinned, fixedMethod, fixedRoute])

  const key = JSON.stringify(params)

  useEffect(() => {

    if (!hostId) {
      return
    }

    let ignore = false

    const load = async () => {

      try {

        const res = await api.get('/apm/traces', { params })

        // The person changed a filter or page while this was in flight
        if (ignore) return

        setData({ key, ...res.data, failed: false })

      } catch (err) {

        console.error('Failed to fetch APM requests:', err)

        if (ignore) return

        setData((previous) =>
          previous && previous.key === key
            ? previous
            : { key, items: [], total: 0, page: params.page, total_pages: 1, failed: true }
        )

      }

    }

    load()

    // Auto-refresh only the first page; refreshing while someone is paging
    // through results would shift rows under them.
    if (params.page !== 1) {
      return () => { ignore = true }
    }

    const interval = setInterval(load, getApmRange(range).refreshMs)

    return () => {
      ignore = true
      clearInterval(interval)
    }

  }, [hostId, range, params, key])

  const ready = data !== null && data.key === key

  const applyDraft = (event) => {
    event.preventDefault()

    const minDuration = draft.minDuration.trim()

    update({
      route: draft.route.trim(),
      // The API takes whole milliseconds; ignore anything else
      minDuration: /^\d+$/.test(minDuration) ? minDuration : ''
    })
  }

  const toggleSort = (column) =>
    update(
      filters.sort === column
        ? { order: filters.order === 'asc' ? 'desc' : 'asc' }
        : { sort: column, order: 'desc' }
    )

  const clearFilters = () => {
    setFilters(INITIAL_FILTERS)
    setDraft({ route: '', minDuration: '' })
  }

  return (
    <div className="
      bg-[#1a1a1a]
      border border-[#2a2a2a]
      rounded-xl
      overflow-hidden
    ">

      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[#2a2a2a]">
        <h2 className="text-lg font-semibold">{title}</h2>

        <div role="group" aria-label="Request views" className="inline-flex rounded-lg border border-[#2a2a2a] bg-[#111] p-1">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={presetActive(filters, preset)}
              onClick={() => update(preset.patch)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                presetActive(filters, preset)
                  ? 'bg-[#2a2a2a] text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <form
        onSubmit={applyDraft}
        className="flex flex-wrap items-end gap-3 px-5 py-4 border-b border-[#2a2a2a]"
      >

        {!pinned && (
          <>
            <label className="text-xs text-gray-500">
              <span className="block mb-1">Method</span>
              <select
                aria-label="Method"
                value={filters.method}
                onChange={(event) => update({ method: event.target.value })}
                className={inputClass}
              >
                <option value="">All methods</option>
                {METHODS.map((method) => (
                  <option key={method} value={method}>{method}</option>
                ))}
              </select>
            </label>

            <label className="text-xs text-gray-500">
              <span className="block mb-1">Route (exact)</span>
              <input
                aria-label="Route"
                value={draft.route}
                onChange={(event) => setDraft({ ...draft, route: event.target.value })}
                placeholder="/api/orders/:id"
                maxLength={255}
                className={`${inputClass} w-56`}
              />
            </label>
          </>
        )}

        <label className="text-xs text-gray-500">
          <span className="block mb-1">Status</span>
          <select
            aria-label="Status"
            value={filters.status}
            onChange={(event) => update({ status: event.target.value })}
            className={inputClass}
          >
            {STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>

        <label className="text-xs text-gray-500">
          <span className="block mb-1">Min duration (ms)</span>
          <input
            aria-label="Minimum duration in milliseconds"
            type="number"
            min="0"
            step="1"
            value={draft.minDuration}
            onChange={(event) => setDraft({ ...draft, minDuration: event.target.value })}
            placeholder="0"
            className={`${inputClass} w-32`}
          />
        </label>

        <button
          type="submit"
          className="rounded-md bg-[#2a2a2a] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#333]"
        >
          Apply
        </button>

        <button
          type="button"
          onClick={clearFilters}
          className="px-2 py-1.5 text-sm text-gray-500 hover:text-gray-300"
        >
          Clear
        </button>

      </form>

      {!ready ? (
        <p className="p-5 text-sm text-gray-500">Loading...</p>
      ) : data.failed ? (
        <p className="p-5 text-sm text-red-400">Couldn't load requests.</p>
      ) : data.items.length === 0 ? (
        data.total > 0 ? (
          <p className="p-5 text-sm text-gray-500">
            There are no requests on this page.{' '}
            <button
              type="button"
              onClick={() => setFilters((current) => ({ ...current, page: 1 }))}
              className="underline hover:text-gray-300"
            >
              Go to the first page
            </button>
          </p>
        ) : (
          <p className="p-5 text-sm text-gray-500">No requests match these filters.</p>
        )
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a2a2a] text-left">
                <SortHeader column="timestamp" label="Time" filters={filters} onSort={toggleSort} />
                <th className="px-5 py-3 text-gray-500 uppercase text-xs tracking-widest">Method</th>
                <th className="px-5 py-3 text-gray-500 uppercase text-xs tracking-widest">Route</th>
                <SortHeader column="status" label="Status" filters={filters} onSort={toggleSort} />
                <SortHeader column="duration" label="Duration" filters={filters} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {data.items.map((trace) => (
                <tr key={trace.id} className="border-b border-[#2a2a2a] last:border-0">
                  <td className="px-5 py-4 text-gray-400">
                    {new Date(trace.timestamp).toLocaleString()}
                  </td>
                  <td className="px-5 py-4 font-mono text-xs text-gray-400">{trace.method}</td>
                  <td className="px-5 py-4 font-medium">{trace.route}</td>
                  <td className={`px-5 py-4 font-semibold ${statusColor(trace.status_code)}`}>
                    {trace.status_code ?? 'â€”'}
                  </td>
                  <td className="px-5 py-4 text-gray-400">{formatMs(trace.duration_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ready && !data.failed && data.total > 0 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-[#2a2a2a] text-sm text-gray-400">
          <span>
            Page {data.page} of {data.total_pages} Â· {data.total.toLocaleString()} requests
          </span>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={data.page <= 1}
              onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}
              className="rounded-md border border-[#2a2a2a] px-3 py-1 hover:bg-[#222] disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={data.page >= data.total_pages}
              onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}
              className="rounded-md border border-[#2a2a2a] px-3 py-1 hover:bg-[#222] disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Next
            </button>
          </div>
        </div>
      )}

    </div>
  )
}