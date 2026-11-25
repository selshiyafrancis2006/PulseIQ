import { useState } from "react";
import { updateAlertRule } from "../../services/alert.service";
import { severityConfig } from "../../config/alertSeverity";
import { METRICS } from "../../config/metricNames";
import { OPERATORS } from "../../config/operators";

export default function AlertRuleCard({
  rule,
  setAlertRules,
  onEdit,
  onDelete
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggleRule() {
    try {
      setBusy(true);
      setError("");

      const updated = await updateAlertRule(rule.id, {
        is_active: !rule.is_active
      });

      setAlertRules((prev) =>
        prev.map((item) =>
          Number(item.id) === Number(updated.id) ? updated : item
        )
      );
    } catch (err) {
      setError(err.message || "Unable to update alert rule.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmAndDelete() {
    try {
      setBusy(true);
      setError("");
      await onDelete();
    } catch (err) {
      setError(err.message || "Unable to delete alert rule.");
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }

  const severity =
    severityConfig[rule.severity] || severityConfig.info;

  const metric = METRICS[rule.metric_name];

  return (
    <div className="
      bg-[#161616] border border-[#2a2a2a] rounded-xl
      p-5 mb-4 hover:border-emerald-500/40 transition-all
    ">
      <div className="flex flex-wrap justify-between items-start gap-5">
        <div className="flex gap-4">
          <div>
            <h3 className="text-lg font-semibold">
              {metric?.name || rule.metric_name}
            </h3>

            <p className="text-sm text-gray-400 mt-1">
              {metric?.description || "Custom monitoring rule."}
            </p>

            <div className="flex flex-wrap gap-10 mt-5">
              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500">
                  Severity
                </p>
                <span className={`inline-block mt-2 px-3 py-1 rounded-full text-xs font-semibold ${severity.badge}`}>
                  {severity.label}
                </span>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500">
                  Status
                </p>
                <p className={`mt-2 font-semibold ${rule.is_active ? "text-emerald-400" : "text-red-400"}`}>
                  {rule.is_active ? "Enabled" : "Disabled"}
                </p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500">
                  Scope
                </p>
                <p className="mt-2 text-sm text-gray-200">
                  {rule.host_id == null ? "All my hosts" : `Host #${rule.host_id}`}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-3">
          <p className="text-xl font-semibold text-white">
            {rule.operator} {rule.threshold}{" "}
            <span className="text-sm font-normal text-gray-400">
              {metric?.unit || ""}
            </span>
          </p>

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onEdit}
              disabled={busy}
              className="px-4 py-2 rounded-lg text-sm bg-[#292929] hover:bg-[#383838] text-gray-200 disabled:opacity-50"
            >
              Edit
            </button>

            <button
              type="button"
              onClick={toggleRule}
              disabled={busy}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 ${
                rule.is_active
                  ? "bg-emerald-900 text-emerald-300 hover:bg-emerald-800"
                  : "bg-[#2a2a2a] text-gray-300 hover:bg-[#3a3a3a]"
              }`}
            >
              {busy ? "Please wait..." : rule.is_active ? "Disable" : "Enable"}
            </button>

            <button
              type="button"
              onClick={() => setConfirmDelete((current) => !current)}
              disabled={busy}
              className="px-4 py-2 rounded-lg text-sm border border-red-900 text-red-300 hover:bg-red-950/40 disabled:opacity-50"
            >
              Delete
            </button>
          </div>

          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="text-xs text-gray-400 hover:text-emerald-400 transition-colors"
          >
            {expanded ? "Hide Details" : "Show Details"}
          </button>
        </div>
      </div>

      {confirmDelete && (
        <div className="mt-5 p-4 rounded-lg border border-red-900/70 bg-red-950/20">
          <p className="text-sm text-gray-200">
            Delete this alert rule? This action cannot be undone.
          </p>

          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={confirmAndDelete}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-red-800 hover:bg-red-700 text-white text-sm disabled:opacity-50"
            >
              {busy ? "Deleting..." : "Confirm Delete"}
            </button>

            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-[#292929] hover:bg-[#383838] text-gray-200 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-400">
          {error}
        </p>
      )}

      {expanded && (
        <div className="mt-6 pt-5 border-t border-[#2a2a2a]">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p className="text-xs text-gray-500 uppercase">Metric Key</p>
              <p className="mt-2 text-sm text-white">{rule.metric_name}</p>
            </div>

            <div>
              <p className="text-xs text-gray-500 uppercase">Operator</p>
              <p className="mt-2 text-sm text-white">
                {OPERATORS[rule.operator] || rule.operator}
              </p>
            </div>

            <div>
              <p className="text-xs text-gray-500 uppercase">Consecutive Samples</p>
              <p className="mt-2 text-sm text-white">{rule.duration ?? 1}</p>
            </div>

            <div>
              <p className="text-xs text-gray-500 uppercase">Rule ID</p>
              <p className="mt-2 text-sm text-white">#{rule.id}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
