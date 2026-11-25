const formatTimestamp = (value) => {
  if (!value) return '—'

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

const formatTags = (tags) => {
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) {
    return '—'
  }

  const entries = Object.entries(tags)
  return entries.length
    ? entries.map(([key, value]) => `${key}: ${value}`).join(', ')
    : '—'
}

export default function CustomMetricsTable({ metrics = [] }) {
  if (!metrics.length) return null

  return (
    <section className="bg-[#0d0d0d] border border-emerald-500/20 rounded-xl p-4 sm:p-6 mb-8">
      <h2 className="text-lg font-semibold text-white mb-4">
        Custom metric observations
      </h2>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase text-gray-400 border-b border-gray-700">
            <tr>
              <th className="py-3 pr-4">Timestamp</th>
              <th className="py-3 pr-4">Value</th>
              <th className="py-3 pr-4">Unit</th>
              <th className="py-3 pr-4">Dimensions</th>
              <th className="py-3 pr-4">Samples</th>
              <th className="py-3">Latest sample</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-800 text-gray-300">
            {metrics.map((row, index) => (
              <tr key={`${row.timestamp}-${index}`}>
                <td className="py-3 pr-4 whitespace-nowrap">
                  {formatTimestamp(row.timestamp)}
                </td>
                <td className="py-3 pr-4 tabular-nums">
                  {Number.isFinite(Number(row.value)) ? row.value : '—'}
                </td>
                <td className="py-3 pr-4">{row.unit || '—'}</td>
                <td className="py-3 pr-4">{formatTags(row.tags)}</td>
                <td className="py-3 pr-4">{row.sample_count ?? '—'}</td>
                <td className="py-3 whitespace-nowrap">
                  {formatTimestamp(row.latest_sample_timestamp)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
