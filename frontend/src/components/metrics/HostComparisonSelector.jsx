export default function HostComparisonSelector({
  hosts,
  primaryHostId,
  selectedHostIds,
  onChange
}) {
  const comparableHosts = hosts.filter(
    host => String(host.id) !== String(primaryHostId)
  )

  if (!comparableHosts.length) return null

  const toggleHost = (hostId, checked) => {
    onChange(
      checked
        ? [...selectedHostIds, hostId]
        : selectedHostIds.filter(id => String(id) !== String(hostId))
    )
  }

  return (
    <fieldset className="rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] p-3">
      <legend className="px-2 text-sm font-medium text-gray-300">
        Compare with
      </legend>

      <div className="flex flex-wrap gap-x-5 gap-y-3">
        {comparableHosts.map(host => (
          <label
            key={host.id}
            className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selectedHostIds.some(
                id => String(id) === String(host.id)
              )}
              onChange={event => toggleHost(host.id, event.target.checked)}
              className="accent-emerald-500"
            />
            {host.name}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

