function MonitorToolbar({
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  tagFilter,
  setTagFilter,
  onAddMonitor,
}) {
  return (
    <div className="mb-6 flex flex-col items-stretch justify-between gap-4 md:flex-row md:items-center">
      <input
        type="text"
        placeholder="Search monitors..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-3 text-white placeholder-gray-500 outline-none focus:border-emerald-500 md:w-72"
      />

      <input
        type="text"
        placeholder="Filter by tag, e.g. env:prod"
        value={tagFilter}
        onChange={(e) => setTagFilter(e.target.value)}
        className="w-full rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-3 text-white placeholder-gray-500 outline-none focus:border-emerald-500 md:w-64"
      />

      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        aria-label="Filter monitors by status"
        className="rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-3 text-white outline-none focus:border-emerald-500"
      >
        <option value="ALL">All statuses</option>
        <option value="UP">UP</option>
        <option value="DOWN">DOWN</option>
      </select>

      <button
        type="button"
        onClick={onAddMonitor}
        className="shrink-0 rounded-lg bg-emerald-600 px-5 py-3 font-medium text-white transition hover:bg-emerald-500"
      >
        + Add Monitor
      </button>
    </div>
  );
}

export default MonitorToolbar;
