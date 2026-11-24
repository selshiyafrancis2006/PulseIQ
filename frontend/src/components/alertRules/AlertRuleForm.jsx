import { useState } from "react";
import { METRICS } from "../../config/metricNames";
import { OPERATORS } from "../../config/operators";

const SUPPORTED_OPERATORS = [">", "<", ">=", "<="];

const inputClass = `
  w-full bg-[#0f0f0f] border border-[#333]
  rounded-lg px-3 py-2 text-white outline-none
  focus:border-emerald-500
`;

export default function AlertRuleForm({
  rule = null,
  hosts = [],
  onSave,
  onCancel
}) {
  const [metricName, setMetricName] = useState(
    rule?.metric_name || "cpu_usage"
  );
  const [operator, setOperator] = useState(
    rule?.operator || ">"
  );
  const [threshold, setThreshold] = useState(
    String(rule?.threshold ?? 80)
  );
  const [duration, setDuration] = useState(
    String(rule?.duration ?? 1)
  );
  const [scope, setScope] = useState(
    rule?.host_id == null ? "global" : "host"
  );
  const [hostId, setHostId] = useState(
    rule?.host_id == null ? "" : String(rule.host_id)
  );
  const [isActive, setIsActive] = useState(
    rule?.is_active ?? true
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const metric = METRICS[metricName];
  const numericThreshold = Number(threshold);
  const numericDuration = Number(duration);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (!Number.isFinite(numericThreshold) || threshold.trim() === "") {
      setError("Enter a valid threshold.");
      return;
    }

    if (
      metric?.unit === "%" &&
      (numericThreshold < 0 || numericThreshold > 100)
    ) {
      setError("Percentage thresholds must be between 0 and 100.");
      return;
    }

    if (metric?.unit !== "%" && numericThreshold < 0) {
      setError("Threshold cannot be negative.");
      return;
    }

    if (
      !Number.isInteger(numericDuration) ||
      numericDuration < 1 ||
      numericDuration > 3600
    ) {
      setError("Duration must be a whole number between 1 and 3600.");
      return;
    }

    if (scope === "host" && !hostId) {
      setError("Select a host for this rule.");
      return;
    }

    const payload = {
      metric_name: metricName,
      operator,
      threshold: numericThreshold,
      duration: numericDuration,
      is_active: isActive,
      host_id: scope === "host" ? Number(hostId) : null
    };

    try {
      setSaving(true);
      await onSave(payload);
    } catch (err) {
      setError(err.message || "Unable to save alert rule.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-[#111] border border-[#333] rounded-xl p-5 space-y-5"
    >
      <div>
        <h2 className="text-lg font-semibold text-white">
          {rule ? "Edit Alert Rule" : "Create Alert Rule"}
        </h2>
        <p className="text-sm text-gray-400 mt-1">
          Configure the metric condition and where it should apply.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block text-sm text-gray-300">
          Metric
          <select
            value={metricName}
            onChange={(event) => setMetricName(event.target.value)}
            className={`${inputClass} mt-2`}
          >
            {Object.entries(METRICS).map(([key, value]) => (
              <option key={key} value={key}>
                {value.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm text-gray-300">
          Operator
          <select
            value={operator}
            onChange={(event) => setOperator(event.target.value)}
            className={`${inputClass} mt-2`}
          >
            {SUPPORTED_OPERATORS.map((value) => (
              <option key={value} value={value}>
                {OPERATORS[value]}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm text-gray-300">
          Threshold ({metric?.unit || "units"})
          <input
            type="number"
            step="any"
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
            className={`${inputClass} mt-2`}
          />
        </label>

        <label className="block text-sm text-gray-300">
          Consecutive samples
          <input
            type="number"
            min="1"
            max="3600"
            step="1"
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            className={`${inputClass} mt-2`}
          />
        </label>

        <label className="block text-sm text-gray-300 md:col-span-2">
          Apply rule to
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            className={`${inputClass} mt-2`}
          >
            <option value="global">All my hosts (global)</option>
            <option value="host" disabled={hosts.length === 0}>
              One specific host
            </option>
          </select>
        </label>

        {scope === "host" && (
          <label className="block text-sm text-gray-300 md:col-span-2">
            Host
            <select
              value={hostId}
              onChange={(event) => setHostId(event.target.value)}
              className={`${inputClass} mt-2`}
            >
              <option value="">Select a host</option>
              {hosts.map((host) => (
                <option key={host.id} value={host.id}>
                  {host.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <label className="flex items-center gap-3 text-sm text-gray-300">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
          className="accent-emerald-500"
        />
        Enable this rule
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold"
        >
          {saving ? "Saving..." : rule ? "Save Changes" : "Create Rule"}
        </button>

        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-5 py-2 rounded-lg bg-[#292929] hover:bg-[#383838] text-gray-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
