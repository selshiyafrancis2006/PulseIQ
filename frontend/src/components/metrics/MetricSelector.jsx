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
  setTimeRange
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

    <div className="flex flex-col md:flex-row justify-between gap-8 mb-8">

      {/* METRICS */}

      <div>

        <p className="text-xs uppercase tracking-widest text-gray-500 mb-3">
          Metrics
        </p>

        <div className="flex flex-col gap-2">

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

      <div>

        <p className="text-xs uppercase tracking-widest text-gray-500 mb-2">
          Time Range
        </p>

        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value)}
          className="
            bg-[#1a1a1a]
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
          <option value="1m">Last 1 Minute</option>
          <option value="5m">Last 5 Minutes</option>
          <option value="15m">Last 15 Minutes</option>
          <option value="1h">Last 1 Hour</option>
        </select>

      </div>

    </div>

  )

}