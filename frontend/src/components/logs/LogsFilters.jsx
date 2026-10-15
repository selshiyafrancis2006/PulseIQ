import {
  AlertCircle,
  AlertTriangle,
  Info,
  Bug,
  Server,
  Monitor,
} from "lucide-react";

const levels = [
  {
    value: "ALL",
    label: "All",
    icon: null,
  },
  {
    value: "ERROR",
    label: "Error",
    icon: AlertCircle,
    color: "text-red-400",
  },
  {
    value: "WARN",
    label: "Warning",
    icon: AlertTriangle,
    color: "text-yellow-400",
  },
  {
    value: "INFO",
    label: "Info",
    icon: Info,
    color: "text-blue-400",
  },
  {
    value: "DEBUG",
    label: "Debug",
    icon: Bug,
    color: "text-zinc-400",
  },
];

export default function LogsFilters({
  level,
  setLevel,
  service,
  setService,
  source,
  setSource,
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-[#111111] p-5">
      <h2 className="mb-4 text-base font-semibold text-white">
        Filters
      </h2>

      {/* Severity */}

      <div className="mb-6">
        <h3 className="mb-3 text-sm font-medium text-zinc-400">
          Severity
        </h3>

        <div className="space-y-2">
          {levels.map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.value}
                onClick={() =>
                  setLevel(item.value)
                }
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  level === item.value
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                {Icon && (
                  <Icon
                    size={16}
                    className={item.color}
                  />
                )}

                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Service */}

      <div className="mb-6">
        <label className="mb-2 flex items-center gap-2 text-sm text-zinc-400">
          <Server size={16} />
          Service
        </label>

        <input
          value={service}
          onChange={(e) =>
            setService(e.target.value)
          }
          placeholder="Authentication API"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
        />
      </div>

      {/* Source */}

      <div>
        <label className="mb-2 flex items-center gap-2 text-sm text-zinc-400">
          <Monitor size={16} />
          Source
        </label>

        <input
          value={source}
          onChange={(e) =>
            setSource(e.target.value)
          }
          placeholder="node-api"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
        />
      </div>
    </div>
  );
}