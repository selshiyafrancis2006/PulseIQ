import { useState } from "react";
import { updateAlertRule } from "../../services/alert.service";
import { severityConfig } from "../../config/alertSeverity";
import { METRICS } from "../../config/metricNames";
import { OPERATORS } from "../../config/operators";


export default function AlertRuleCard({
  rule,
  setAlertRules
}) {

  const [expanded, setExpanded] = useState(false);
  async function updateThreshold(value) {

    const threshold = parseFloat(value);

    if (isNaN(threshold)) return;

    try {

      const updated = await updateAlertRule(rule.id, {
        threshold,
        is_active: rule.is_active
      });

      setAlertRules(prev =>
        prev.map(r =>
          r.id === updated.id ? updated : r
        )
      );

    } catch (err) {

      console.error(err);

    }

  }

  async function toggleRule() {

    try {

      const updated = await updateAlertRule(rule.id, {
        threshold: rule.threshold,
        is_active: !rule.is_active
      });

      setAlertRules(prev =>
        prev.map(r =>
          r.id === updated.id ? updated : r
        )
      );

    } catch (err) {

      console.error(err);

    }

  }

  const severity =
  severityConfig[rule.severity] ||
  severityConfig.info;

  return (



    

    <div className="
      bg-[#161616]
      border
      border-[#2a2a2a]
      rounded-xl
      p-5
      mb-4
      hover:border-emerald-500/40
      transition-all
    ">

      <div className="flex justify-between items-start">

        {/* Left */}

        <div className="flex gap-4">


          <div>

            <h3 className="text-lg font-semibold">
{METRICS[rule.metric_name]?.name || rule.metric_name}
</h3>

            <p className="text-sm text-gray-400 mt-1">

              {METRICS[rule.metric_name]?.description ||
  "Custom monitoring rule."}

            </p>

            <div className="flex gap-10 mt-5">

  <div>

    <p className="text-xs uppercase tracking-wider text-gray-500">
      Severity
    </p>

    <span
      className={`inline-block mt-2 px-3 py-1 rounded-full text-xs font-semibold ${severity.badge}`}
    >
      {severity.label}
    </span>

  </div>

  <div>

    <p className="text-xs uppercase tracking-wider text-gray-500">
      Status
    </p>

    <p
      className={`mt-2 font-semibold ${
        rule.is_active
          ? "text-emerald-400"
          : "text-red-400"
      }`}
    >
      {rule.is_active ? "Enabled" : "Disabled"}
    </p>

  </div>

</div>

          </div>

        </div>

        {/* Right */}

        <div className="flex flex-col items-end gap-3">

          <div className="flex items-center gap-2">

            <input
              type="number"
              defaultValue={rule.threshold}
              min={0}
              max={100}
              onBlur={(e) =>
                updateThreshold(e.target.value)
              }
              className="
                w-24
                bg-[#0f0f0f]
                border
                border-[#2a2a2a]
                rounded-lg
                px-3
                py-2
                outline-none
                text-center
                focus:border-emerald-400
              "
            />

            <span className="text-gray-400">
  {METRICS[rule.metric_name]?.unit || ""}
</span>

          </div>

          <button
            onClick={toggleRule}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
              rule.is_active
                ? "bg-emerald-900 text-emerald-300 hover:bg-emerald-800"
                : "bg-[#2a2a2a] text-gray-300 hover:bg-[#3a3a3a]"
            }`}
          >
            {rule.is_active
              ? "Disable"
              : "Enable"}
          </button>

          <button
  onClick={() => setExpanded(!expanded)}
  className="
    text-xs
    text-gray-400
    hover:text-emerald-400
    transition-colors
  "
>
  {expanded ? "Hide Details" : "Show Details"}
</button>

        </div>

      </div>

      {expanded && (

  <div className="
    mt-6
    pt-5
    border-t
    border-[#2a2a2a]
  ">

    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">

      <div>
        <p className="text-xs text-gray-500 uppercase">
          Metric Key
        </p>

        <p className="mt-2 text-sm text-white">
          {rule.metric_name}
        </p>
      </div>

      <div>
        <p className="text-xs text-gray-500 uppercase">
          Operator
        </p>

        <p className="mt-2 text-sm text-white">
{OPERATORS[rule.operator] || rule.operator}
        </p>
      </div>

      <div>
        <p className="text-xs text-gray-500 uppercase">
          Threshold
        </p>

        <p className="mt-2 text-sm text-white">
          {rule.threshold} {METRICS[rule.metric_name]?.unit || ""}
        </p>
      </div>

      <div>
        <p className="text-xs text-gray-500 uppercase">
          Rule ID
        </p>

        <p className="mt-2 text-sm text-white">
          #{rule.id}
        </p>
      </div>

    </div>

  </div>

)}

    </div>

  );

}