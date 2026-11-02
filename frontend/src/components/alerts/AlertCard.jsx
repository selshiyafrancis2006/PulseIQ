
import { severityConfig } from "../../config/alertSeverity";

export default function AlertCard({ alert, onAcknowledge, isAcknowledging = false, acknowledgementError }) {
  const severity =
    severityConfig[
      (alert.severity || "info").toLowerCase()
    ] || severityConfig.info;

  const isHostOffline = alert.metric_name === "host_offline";

  return (
    <div
      className="
      border border-[#2a2a2a]
      bg-[#0f0f0f]
      rounded-xl
      p-5
      hover:border-[#444]
      transition
      "
    >
      <div className="flex justify-between">
        <div className="flex gap-3 items-center">
          <span
            className={`
            px-3 py-1
            rounded-full
            text-xs
            font-semibold
            ${severity.badge}
            `}
          >
            {severity.label}
          </span>

          <h3 className="font-semibold text-lg">
            {isHostOffline
              ? "HOST OFFLINE"
              : alert.metric_name?.replace("_", " ").toUpperCase()}
          </h3>
        </div>

        <span className="text-gray-500 text-xs">
          {new Date(alert.timestamp).toLocaleString()}
        </span>
      </div>

      {isHostOffline ? (
        <div className="mt-4 bg-[#151515] p-4 rounded-lg">
          <p className="text-red-400 font-semibold">
            Host went offline
          </p>
          <p className="text-gray-400 text-sm mt-1">
            No heartbeat received for more than 30 seconds.
          </p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-3 gap-4">
          <div className="bg-[#151515] p-3 rounded-lg">
            <p className="text-gray-500 text-xs">Current Value</p>
            <p className="text-xl font-bold">
              {alert.current_value}
            </p>
          </div>

          <div className="bg-[#151515] p-3 rounded-lg">
            <p className="text-gray-500 text-xs">Threshold</p>
            <p className="text-xl font-bold">
              {alert.threshold_value}
            </p>
          </div>

          <div className="bg-[#151515] p-3 rounded-lg">
            <p className="text-gray-500 text-xs">Status</p>
            <p className="text-emerald-400 font-semibold">
              {alert.current_value > alert.threshold_value
                ? "Triggered"
                : "Resolved"}
            </p>
          </div>
        </div>
      )}

      {acknowledgementError && (
        <p role="alert" className="mt-3 text-red-400 text-sm">
          {acknowledgementError}
        </p>
      )}
      <div className="mt-4 flex items-center justify-end">
        {alert.acknowledged_at ? (
          <span className="text-emerald-400 text-sm">
            Acknowledged · {new Date(alert.acknowledged_at).toLocaleString()}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onAcknowledge?.(alert.id)}
            disabled={isAcknowledging}
            className="px-4 py-2 rounded-lg border border-emerald-700 text-emerald-400 text-sm font-medium hover:bg-emerald-950 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isAcknowledging ? "Acknowledging..." : "Acknowledge"}
          </button>
        )}
      </div>
    </div>
  );
}