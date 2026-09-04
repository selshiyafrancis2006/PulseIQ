function HostSelector({ hosts, selectedHostId, onChange }) {
  if (hosts.length === 0) {
    return null;
  }

  return (
    <select
      value={selectedHostId ?? ""}
      onChange={(e) => onChange(Number(e.target.value))}
      className="bg-gray-800 text-white border border-gray-700 rounded-md px-3 py-1.5 text-sm"
    >
      {hosts.map((host) => (
        <option key={host.id} value={host.id}>
          {host.name}
        </option>
      ))}
    </select>
  );
}

export default HostSelector;