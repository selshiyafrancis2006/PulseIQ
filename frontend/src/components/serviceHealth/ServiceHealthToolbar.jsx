import { Search, RotateCw, Filter } from "lucide-react";

export default function ServiceHealthToolbar({
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  onRefresh,
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">

      {/* Search */}
      <div className="relative flex-1 max-w-md">
        <Search
          size={18}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
        />

        <input
          type="text"
          placeholder="Search services..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-[#161B22] border border-gray-700 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
        />
      </div>

      <div className="flex items-center gap-3">

        {/* Filter */}
        <div className="relative">
          <Filter
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="appearance-none bg-[#161B22] border border-gray-700 rounded-lg pl-10 pr-10 py-2.5 text-white focus:outline-none focus:border-emerald-500"
          >
            <option value="All">All Status</option>
            <option value="Healthy">Healthy</option>
            <option value="Degraded">Degraded</option>
            <option value="Down">Down</option>
          </select>
        </div>

        {/* Refresh */}
        <button
          onClick={onRefresh}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 px-4 py-2.5 rounded-lg transition-colors"
        >
          <RotateCw size={18} />
          Refresh
        </button>

      </div>
    </div>
  );
}