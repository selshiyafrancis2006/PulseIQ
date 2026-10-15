import {
  STATUS_FILTERS,
  SEVERITY_FILTERS
} from "../../config/alertFilters";

import {
  ALERT_SORT_OPTIONS
} from "../../config/alertSortOptions";

export default function AlertFilters({
  search,
  setSearch,
  filter,
  setFilter,
  severity,
  setSeverity,
  sortBy,
  setSortBy
}) {

  return (

    <div className="flex flex-wrap gap-4 mb-6">

      {/* Search */}

      <input
        type="text"
        placeholder="Search metrics..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="
          flex-1
          min-w-[250px]
          bg-[#1a1a1a]
          border border-[#2a2a2a]
          rounded-lg
          px-4
          py-2
          outline-none
          text-white
          placeholder:text-gray-500
          focus:border-emerald-400
        "
      />

      {/* Status */}

      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="
          bg-[#1a1a1a]
          border border-[#2a2a2a]
          rounded-lg
          px-4
          py-2
        "
      >

        {STATUS_FILTERS.map(option => (

          <option
            key={option.value}
            value={option.value}
          >
            {option.label}
          </option>

        ))}

      </select>

      {/* Severity */}

      <select
        value={severity}
        onChange={(e) => setSeverity(e.target.value)}
        className="
          bg-[#1a1a1a]
          border border-[#2a2a2a]
          rounded-lg
          px-4
          py-2
        "
      >

        {SEVERITY_FILTERS.map(option => (

          <option
            key={option.value}
            value={option.value}
          >
            {option.label}
          </option>

        ))}

      </select>

      {/* Sort */}

      <select
        value={sortBy}
        onChange={(e) => setSortBy(e.target.value)}
        className="
          bg-[#1a1a1a]
          border border-[#2a2a2a]
          rounded-lg
          px-4
          py-2
        "
      >

        {ALERT_SORT_OPTIONS.map(option => (

          <option
            key={option.value}
            value={option.value}
          >
            {option.label}
          </option>

        ))}

      </select>

    </div>

  );

}