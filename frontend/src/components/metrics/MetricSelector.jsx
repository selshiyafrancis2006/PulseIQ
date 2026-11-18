const metricOptions = [
  {
    label: 'CPU Usage',
    value: 'cpu_usage'
  },
  {
    label: 'Memory Usage',
    value: 'memory_usage'
  },
  {
    label: 'Disk Usage',
    value: 'disk_usage'
  },
  {
    label: 'Network In',
    value: 'network_in'
  },
  {
    label: 'Network Out',
    value: 'network_out'
  }
]

export default function MetricSelector({
  selectedMetrics,
  setSelectedMetrics,
  timeRange,
  setTimeRange,
  step,
  setStep,
  aggregation,
  setAggregation,
  compatibleSteps = ["1m", "5m", "15m", "1h", "6h", "1d"],
  p95Available = true,
  customFrom = '',
  setCustomFrom,
  customTo = '',
  setCustomTo,
  customRangeError = null
}) {

  const toggleMetric = (metric) => {

    if (selectedMetrics.includes(metric)) {

      // Prevent removing the last selected metric
      if (selectedMetrics.length === 1) return

      setSelectedMetrics(
        selectedMetrics.filter(m => m !== metric)
      )

    } else {

      setSelectedMetrics([
        ...selectedMetrics,
        metric
      ])

    }

  }

  return (

    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(180px,0.8fr)_minmax(0,1.4fr)] items-start gap-6 mb-8">

      {/* METRICS */}

      <div className="min-w-0">

        <p className="text-xs uppercase tracking-widest text-gray-500 mb-3">
          Metrics
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">

          {metricOptions.map(metric => (

            <label
              key={metric.value}
              className="flex items-center gap-3 cursor-pointer text-sm"
            >

              <input
                type="checkbox"
                checked={selectedMetrics.includes(metric.value)}
                onChange={() => toggleMetric(metric.value)}
                className="accent-emerald-500"
              />

              <span>
                {metric.label}
              </span>

            </label>

          ))}

        </div>

      </div>

      {/* TIME RANGE */}

      <div className="min-w-0">

        <label htmlFor="metrics-time-range" className="text-xs uppercase tracking-widest text-gray-500 mb-2 block">
          Time Range
        </label>

        <select
          id="metrics-time-range"
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value)}
          className="
            w-full sm:w-auto bg-[#1a1a1a]
            border
            border-[#2a2a2a]
            rounded-lg
            px-4
            py-2
            text-white
            outline-none
            focus:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0d0d]
          "
        >
          <option value="1m">Last 1 Minute</option>
          <option value="5m">Last 5 Minutes</option>
          <option value="15m">Last 15 Minutes</option>
          <option value="1h">Last 1 Hour</option>
          <option value="6h">Last 6 Hours</option>
          <option value="24h">Last 24 Hours</option>
          <option value="3d">Last 3 Days</option>
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
          <option value="90d">Last 90 Days</option>
          <option value="custom">Custom Range</option>
        </select>

        {timeRange === 'custom' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
            <div>
              <label htmlFor="metrics-custom-from" className="text-xs text-gray-400 mb-2 block">
                Start date/time
              </label>
              <input
                id="metrics-custom-from"
                type="datetime-local"
                value={customFrom}
                onChange={(e) => setCustomFrom?.(e.target.value)}
                aria-invalid={Boolean(customRangeError)}
                className="w-full min-w-0 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0d0d]"
              />
            </div>
            <div>
              <label htmlFor="metrics-custom-to" className="text-xs text-gray-400 mb-2 block">
                End date/time
              </label>
              <input
                id="metrics-custom-to"
                type="datetime-local"
                value={customTo}
                onChange={(e) => setCustomTo?.(e.target.value)}
                aria-invalid={Boolean(customRangeError)}
                className="w-full min-w-0 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0d0d]"
              />
            </div>
            {customRangeError ? (
              <p role="alert" className="sm:col-span-2 text-xs text-red-400">
                {customRangeError}
              </p>
            ) : null}
          </div>
        ) : null}

      </div>
      {/* QUERY SETTINGS */}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
        <div>
          <label htmlFor="metrics-step" className="text-xs uppercase tracking-widest text-gray-500 mb-2 block">
            Step
          </label>
          <select
            id="metrics-step"
            value={step}
            onChange={(e) => setStep(e.target.value)}
            className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-2 text-white outline-none focus:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0d0d]"
          >
            <option value="1m" disabled={!compatibleSteps.includes("1m")}>1 minute</option>
            <option value="5m" disabled={!compatibleSteps.includes("5m")}>5 minutes</option>
            <option value="15m" disabled={!compatibleSteps.includes("15m")}>15 minutes</option>
            <option value="1h" disabled={!compatibleSteps.includes("1h")}>1 hour</option>
            <option value="6h" disabled={!compatibleSteps.includes("6h")}>6 hours</option>
            <option value="1d" disabled={!compatibleSteps.includes("1d")}>1 day</option>
          </select>
        </div>

        <div>
          <label htmlFor="metrics-aggregation" className="text-xs uppercase tracking-widest text-gray-500 mb-2 block">
            Aggregation
          </label>
          <select
            id="metrics-aggregation"
            value={aggregation}
            onChange={(e) => setAggregation(e.target.value)}
            className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-2 text-white outline-none focus:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0d0d]"
          >
            <option value="avg">Average</option>
            <option value="min">Minimum</option>
            <option value="max">Maximum</option>
            <option value="p95" disabled={!p95Available}>95th percentile (P95)</option>
          </select>
          {!p95Available ? ( <p className="text-xs text-gray-500 mt-2">P95 is unavailable when this range includes rolled-up data.</p> ) : null}
        </div>
      </div>


    </div>

  )

}



