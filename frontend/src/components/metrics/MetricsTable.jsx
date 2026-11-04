import { useMemo, useState } from 'react'
import { formatMetricValue } from '../../utils/metricFormatting'
import { METRICS } from '../../config/metricNames'

export default function MetricsTable({
  metrics,
  selectedMetric
}) {

  const [search, setSearch] = useState('')
  const [sortOrder, setSortOrder] = useState('newest')

  const getStatus = (value) => {
    const thresholds = METRICS[selectedMetric]?.thresholds

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
  const filteredMetrics = useMemo(() => {

    let data = [...metrics]

    data = data.filter(metric =>
      new Date(metric.collected_at ?? metric.timestamp)
        .toLocaleString()
        .toLowerCase()
        .includes(search.toLowerCase())
    )

    data.sort((a, b) => {

      if (sortOrder === 'newest') {
        return new Date(b.collected_at ?? b.timestamp) - new Date(a.collected_at ?? a.timestamp)
      }

      if (sortOrder === 'oldest') {
        return new Date(a.collected_at ?? a.timestamp) - new Date(b.collected_at ?? b.timestamp)
      }

      if (sortOrder === 'highest') {
        return b[selectedMetric] - a[selectedMetric]
      }

      return a[selectedMetric] - b[selectedMetric]

    })

    return data

  }, [metrics, search, sortOrder, selectedMetric])

  return (

    <div
      className="
        bg-[#1a1a1a]
        border
        border-[#2a2a2a]
        rounded-xl
        p-6
      "
    >

      <div className="flex flex-col md:flex-row justify-between gap-4 mb-6">

        <input
          type="text"
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
            focus:border-emerald-400
          "
        />

        <select
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
            focus:border-emerald-400
          "
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="highest">Highest Value</option>
          <option value="lowest">Lowest Value</option>
        </select>

      </div>

      <div className="overflow-auto max-h-[500px]">

        <table className="w-full text-sm">

          <thead className="sticky top-0 bg-[#1a1a1a]">

            <tr className="border-b border-[#2a2a2a]">

              <th className="text-left py-3">
                Time
              </th>

              <th className="text-left py-3">
                Value
              </th>

              <th className="text-left py-3">
                Status
              </th>

            </tr>

          </thead>

          <tbody>

            {filteredMetrics.map(metric => {

              const value =
                parseFloat(metric[selectedMetric])

              const status =
                getStatus(value)

              return (

                <tr
                  key={metric.id}
                  className="
                    border-b
                    border-[#2a2a2a]
                    hover:bg-[#141414]
                  "
                >

                  <td className="py-3">

                    {new Date(metric.collected_at ?? metric.timestamp)
                      .toLocaleString()}

                  </td>

                  <td className="py-3">

                    {formatMetricValue(selectedMetric, value)}

                  </td>

                  <td className="py-3">

                    {status ? (
                      <span
                        className={`
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
                    ) : (
                      <span className="text-gray-500" aria-label="Status not applicable">
                        —
                      </span>
                    )}

                  </td>

                </tr>

              )

            })}

          </tbody>

        </table>

      </div>

    </div>

  )

}


