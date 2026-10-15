import {
  AlertCircle,
  AlertTriangle,
  Info,
  Bug,
} from "lucide-react";


const levelConfig = {
  ERROR: {
    icon: AlertCircle,
    color: "text-red-400",
  },

  WARN: {
    icon: AlertTriangle,
    color: "text-yellow-400",
  },

  INFO: {
    icon: Info,
    color: "text-blue-400",
  },

  DEBUG: {
    icon: Bug,
    color: "text-zinc-400",
  },
};


export default function LogCard({
  log,
  selected,
  onSelect,
}) {

  const config =
    levelConfig[log.level] || levelConfig.INFO;

  const Icon = config.icon;


  return (
    <div
      onClick={() => onSelect(log)}
      className={`
        flex items-center gap-4
        px-4 py-3
        cursor-pointer
        border-b border-zinc-800
        transition
        ${
          selected
          ? "bg-emerald-500/10"
          : "hover:bg-zinc-900"
        }
      `}
    >

      {/* Time */}

      <span className="w-20 text-xs text-zinc-500">
        {
          new Date(log.created_at)
          .toLocaleTimeString()
        }
      </span>


      {/* Level */}

      <div className="flex items-center gap-2 w-24">

        <Icon
          size={16}
          className={config.color}
        />

        <span
          className={`text-sm ${config.color}`}
        >
          {log.level}
        </span>

      </div>


      {/* Service */}

      <span className="w-40 text-sm text-white">
        {log.service}
      </span>


      {/* Source */}

      <span className="w-24 text-sm text-zinc-400">
        {log.source}
      </span>


      {/* Message */}

      <p className="flex-1 truncate text-sm text-zinc-300">
        {log.message}
      </p>


      {/* Response */}

      <span className="text-xs text-zinc-500">
        {log.response_time_ms}ms
      </span>


    </div>
  );
}