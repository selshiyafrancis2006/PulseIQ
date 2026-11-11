// Shown when the request succeeded but the host has no samples in the range
export default function MetricsEmptyState({ hostName }) {

  return (

    <div
      role="status"
      className="
        bg-[#1a1a1a]
        border
        border-[#2a2a2a]
        rounded-xl
        p-10
        text-center
      "
    >

      <h2 className="text-lg font-semibold text-white mb-2">
        No data for this range
      </h2>

      <p className="text-sm text-gray-400">
        {hostName
          ? `${hostName} has not reported any metrics in the selected time range.`
          : 'No metrics were reported in the selected time range.'}
        {' '}Check that its agent is running, or try a longer range.
      </p>

    </div>

  )

}