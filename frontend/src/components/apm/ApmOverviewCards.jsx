import {
  formatMs,
  formatPercent,
  formatThroughput
} from '../../utils/apm'

function Card({ label, value, tone = 'text-white', hint }) {
  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-5 py-4">
      <p className="text-xs uppercase tracking-widest text-gray-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${tone}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

export default function ApmOverviewCards({ overview }) {

  if (!overview) return null

  const hasErrors = Number(overview.error_count) > 0

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      <Card label="Requests" value={overview.request_count.toLocaleString()} />
      <Card label="Throughput" value={formatThroughput(overview.throughput_rpm)} />
      <Card label="p50" value={formatMs(overview.p50_duration_ms)} tone="text-emerald-400" />
      <Card label="p95" value={formatMs(overview.p95_duration_ms)} tone="text-amber-400" />
      <Card label="p99" value={formatMs(overview.p99_duration_ms)} tone="text-rose-400" />
      <Card
        label="Error rate"
        value={formatPercent(overview.error_rate)}
        tone={hasErrors ? 'text-red-400' : 'text-white'}
        hint={`${overview.error_count.toLocaleString()} server errors (5xx)`}
      />
    </div>
  )
}