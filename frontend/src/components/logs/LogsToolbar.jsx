import {
  Search,
  RefreshCw,
  Play,
  Pause,
  Clock,
} from "lucide-react";

export default function LogsToolbar({
  search,
  setSearch,
  timeRange,
  setTimeRange,
  liveMode,
  setLiveMode,
  onRefresh,
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-zinc-800 bg-[#111111] p-4 lg:flex-row lg:items-center lg:justify-between">

      {/* Search */}
      <div className="relative flex-1 max-w-2xl">
        <Search
          size={18}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
        />

        <input
          type="text"
          value={search}
          onChange={(e) =>
            setSearch(e.target.value)
          }
          placeholder="Search logs by message, service, host..."
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2.5 pl-10 pr-4 text-sm text-white outline-none transition focus:border-emerald-500"
        />
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3">

        <div className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2">
          <Clock
            size={16}
            className="text-zinc-400"
          />

          <select
            value={timeRange}
            onChange={(e) =>
              setTimeRange(e.target.value)
            }
            className="bg-transparent text-sm text-white outline-none"
          >
            <option value="5m">Last 5 min</option>
            <option value="15m">Last 15 min</option>
            <option value="1h">Last 1 hour</option>
            <option value="6h">Last 6 hours</option>
            <option value="24h">Last 24 hours</option>
          </select>
        </div>

        <button
          onClick={() =>
            setLiveMode(!liveMode)
          }
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
            liveMode
              ? "border border-emerald-500 bg-emerald-500/10 text-emerald-400"
              : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          }`}
        >
          {liveMode ? (
            <>
              <Pause size={16} />
              Live
            </>
          ) : (
            <>
              <Play size={16} />
              Paused
            </>
          )}
        </button>

        <button
          onClick={onRefresh}
          className="flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-white transition hover:bg-zinc-800"
        >
          <RefreshCw size={16} />
          Refresh
        </button>

      </div>
    </div>
  );
}