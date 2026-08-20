import {
  Server,
  Clock3,
  AlertTriangle,
  Activity,
} from "lucide-react";
import ServiceStatusBadge from "./ServiceStatusBadge";
import ServiceTimeline from "./ServiceTimeline";

export default function ServiceCard({ service }) {
  return (
    <div className="bg-[#161B22] border border-gray-800 rounded-xl p-6 hover:border-emerald-500 transition-all duration-200">

      {/* Header */}
      {/* Header */}
<div className="flex items-start justify-between">

  <div className="flex items-center gap-3">
    <div className="p-2 rounded-lg bg-emerald-500/10">
      <Server className="w-5 h-5 text-emerald-400" />
    </div>

    <div>
      <h2 className="text-lg font-semibold text-white">
        {service.name}
      </h2>

      <p className="text-sm text-gray-400">
        {service.description}
      </p>
    </div>
  </div>

  <ServiceStatusBadge status={service.status} />

</div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-4 mt-6">

        <div className="bg-[#0D1117] rounded-lg p-4">
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <Activity size={16} />
            Uptime
          </div>

          <p className="text-xl font-semibold text-white mt-2">
            {service.uptime}
          </p>
        </div>

        <div className="bg-[#0D1117] rounded-lg p-4">
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <Clock3 size={16} />
            Response
          </div>

          <p className="text-xl font-semibold text-white mt-2">
            {service.responseTime}
          </p>
        </div>

        <div className="bg-[#0D1117] rounded-lg p-4">
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <AlertTriangle size={16} />
            Error Rate
          </div>

          <p className="text-xl font-semibold text-white mt-2">
            {service.errorRate}
          </p>
        </div>

        <div className="bg-[#0D1117] rounded-lg p-4">
          <div className="text-gray-400 text-sm">
            Last Incident
          </div>

          <p className="text-lg font-semibold text-white mt-2">
            {service.lastIncident}
          </p>
        </div>

      </div>

      {/* Health Timeline */}

<div className="mt-6">
  <ServiceTimeline timeline={service.timeline} />
</div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-800">

  <div>
    <p className="text-xs text-gray-500">
      Health Score
    </p>

    <p className="text-lg font-semibold text-emerald-400">
      {service.healthScore}%
    </p>
  </div>

  <div className="text-right">
    <p className="text-xs text-gray-500">
      Status
    </p>

    <ServiceStatusBadge status={service.status} />
  </div>

</div>

    </div>
  );
}