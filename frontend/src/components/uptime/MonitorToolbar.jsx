function MonitorToolbar({
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
}) {
  return (
    <div className="flex flex-col md:flex-row gap-4 justify-between items-center mb-6">

      <input
        type="text"
        placeholder="Search monitors..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full md:w-96 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-3 text-white placeholder-gray-500 outline-none focus:border-emerald-500"
      />

      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-3 text-white outline-none focus:border-emerald-500"
      >
        <option value="ALL">All</option>
        <option value="UP">UP</option>
        <option value="DOWN">DOWN</option>
      </select>

    </div>
  );
}

export default MonitorToolbar;