import { useMemo, useState } from 'react'
import { formatMetricValue, getMetricUnit } from '../../utils/metricFormatting'
import { METRICS } from '../../config/metricNames'

const getTimestamp = (metric) => metric.collected_at ?? metric.timestamp

const getStatus = (metricName, value) => {
  const thresholds = METRICS[metricName]?.thresholds

  if (!thresholds || !Number.isFinite(value)) {
    return null
  }

  if (value >= thresholds.critical) {
    return {
      label: 'Critical',
      className: 'bg-red-950 text-red-300 border border-red-800'
    }
  }

  if (value >= thresholds.warning) {
    return {
      label: 'Warning',
      className: 'bg-amber-950 text-amber-300 border border-amber-800'
    }
  }

  return {
    label: 'Normal',
    className: 'bg-[#1a1a1a] text-gray-300 border border-[#2a2a2a]'
  }
}

// Missing values sort last in both directions
const compareValues = (a, b, direction) => {
  const aMissing = !Number.isFinite(a)
  const bMissing = !Number.isFinite(b)

  if (aMissing && bMissing) return 0
  if (aMissing) return 1
  if (bMissing) return -1

  return direction === 'highest' ? b - a : a - b
}

export default function MetricsTable({
  metrics,
  selectedMetrics,
  hosts = [],
  showHost = false
}) {

  const [search, setSearch] = useState('')
  const [sortOrder, setSortOrder] = useState('newest')

  // "Highest" and "Lowest" rank by the first selected metric
  const sortMetric = selectedMetrics[0]
  const sortMetricName = METRICS[sortMetric]?.name ?? sortMetric

  const filteredMetrics = useMemo(() => {

    const query = search.toLowerCase()

    const data = metrics.filter(metric =>
      new Date(getTimestamp(metric))
        .toLocaleString()
        .toLowerCase()
        .includes(query)
    )

    data.sort((a, b) => {

      if (sortOrder === 'newest') {
        return new Date(getTimestamp(b)) - new Date(getTimestamp(a))
      }

      if (sortOrder === 'oldest') {
        return new Date(getTimestamp(a)) - new Date(getTimestamp(b))
      }

      return compareValues(
        parseFloat(a[sortMetric]),
        parseFloat(b[sortMetric]),
        sortOrder
      )

    })

    return data

  }, [metrics, search, sortOrder, sortMetric])

  return (

    <div
      className="
        bg-[#1a1a1a]
        border
        border-[#2a2a2a]
        rounded-xl
        p-4 sm:p-6
      "
    >

      <div className="flex flex-col md:flex-row justify-between gap-4 mb-6">

        <input
          type="text"
          aria-label="Search metrics by timestamp"
          placeholder="Search timestamp..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="
            bg-[#0f0f0f]
            border
            border-[#2a2a2a]
            rounded-lg
            px-4
            py-2
            text-white
            outline-none
            flex-1
            focus:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1a1a]
          "
        />

        <select
          aria-label="Sort metrics"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          className="
            bg-[#0f0f0f]
            border
            border-[#2a2a2a]
            rounded-lg
            px-4
            py-2
            text-white
            outline-none
            focus:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1a1a]
          "
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="highest">Highest {sortMetricName}</option>
          <option value="lowest">Lowest {sortMetricName}</option>
        </select>

      </div>

      <div className="overflow-auto max-h-[500px]">

        <table className="min-w-[640px] w-full text-sm">

          <thead className="sticky top-0 bg-[#1a1a1a]">

            <tr className="border-b border-[#2a2a2a]">

              <th className="text-left py-3 whitespace-nowrap">
                Time
              </th>

              {showHost && (
                <th className="text-left py-3 whitespace-nowrap">Host</th>
              )}

              

              {selectedMetrics.map(metricName => (
                <th
                  key={metricName}
                  className="text-left py-3 whitespace-nowrap"
                >
                  {METRICS[metricName]?.name ?? metricName}
                  {getMetricUnit(metricName) && ` (${getMetricUnit(metricName)})`}
                </th>
              ))}

            </tr>

          </thead>

          <tbody>

            {filteredMetrics.map((metric, index) => (

              <tr
                key={metric.id ?? `${metric.host_id ?? "host"}-${getTimestamp(metric) ?? "unknown"}-${index}`}
                className="
                  border-b
                  border-[#2a2a2a]
                  hover:bg-[#141414]
                "
              >

                <td className="py-3 whitespace-nowrap">

                  {new Date(getTimestamp(metric)).toLocaleString()}

                </td>

                {showHost && (
                  <td className="py-3 whitespace-nowrap text-gray-300">
                    {hosts.find(host => String(host.id) === String(metric.host_id))?.name ?? ('Host ' + (metric.host_id ?? 'Unknown'))}
                  </td>
                )}

                

                {selectedMetrics.map(metricName => {

                  const value = parseFloat(metric[metricName])
                  const status = getStatus(metricName, value)

                  return (

                    <td
                      key={metricName}
                      className="py-3 whitespace-nowrap"
                    >

                      <span>
                        {formatMetricValue(metricName, value)}
                      </span>

                      {status && (
                        <span
                          className={`
                            ml-3
                            px-3
                            py-1
                            rounded-full
                            text-xs
                            font-semibold
                            ${status.className}
                          `}
                        >
                          {status.label}
                        </span>
                      )}

                    </td>

                  )

                })}

              </tr>

            ))}

            {filteredMetrics.length === 0 && (
              <tr>
                <td
                  colSpan={selectedMetrics.length + (showHost ? 2 : 1)}
                  className="py-8 text-center text-gray-400"
                >
                  {search
                    ? 'No metrics match your search.'
                    : 'No metric data available.'}
                </td>
              </tr>
            )}

          </tbody>

        </table>

      </div>

    </div>

  )

}




