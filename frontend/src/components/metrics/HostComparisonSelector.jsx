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
    <fieldset className="min-w-0 rounded-xl border border-[#303030] bg-[#171717] px-3 py-2.5">
      <legend className="mb-2 block px-0 text-xs font-semibold uppercase tracking-wider text-gray-400">
        Compare with
      </legend>

      <div className="flex flex-wrap items-center gap-2">
        {comparableHosts.map(host => (
          <label
            key={host.id}
            className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${selectedHostIds.some(id => String(id) === String(host.id)) ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300" : "border-[#303030] bg-[#202020] text-gray-300 hover:border-gray-500"}`}
          >
            <input
              type="checkbox"
              checked={selectedHostIds.some(
                id => String(id) === String(host.id)
              )}
              onChange={event => toggleHost(host.id, event.target.checked)}
              className="shrink-0 accent-emerald-500"
            />
            {host.name}
          </label>
        ))}
      </div>
    </fieldset>
  )
}



