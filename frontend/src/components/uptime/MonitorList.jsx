import MonitorCard from './MonitorCard';
import { DEGRADED_THRESHOLD_MS } from '../../config/monitoring';

function MonitorList({
  monitors,
  loading,
  timeRange,
  onEdit,
  onTogglePause,
  onRotateHeartbeatToken,
  heartbeatRotationPopup,
onDismissHeartbeatRotationPopup,
  busyMonitorId,
  onDelete,

  onConfirmDelete,
  deleteTarget,
  onCancelDelete,
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a]">
        <div className="p-6 text-gray-400">Loading monitors...</div>
      </div>
    );
  }

  if (monitors.length === 0) {
    return (
      <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a]">
        <div className="p-6 text-gray-400">No monitors configured.</div>
      </div>
    );
  }

  const paused = monitors.filter((monitor) => monitor.is_active === false);
  const active = monitors.filter((monitor) => monitor.is_active !== false);

  const healthy = active.filter(
    (monitor) =>
      monitor.status === 'UP' &&
      monitor.response_time_ms != null &&
      Number.isFinite(Number(monitor.response_time_ms)) &&
      Number(monitor.response_time_ms) <= DEGRADED_THRESHOLD_MS
  );

  const degraded = active.filter(
    (monitor) =>
      monitor.status === 'UP' &&
      monitor.response_time_ms != null &&
      Number.isFinite(Number(monitor.response_time_ms)) &&
      Number(monitor.response_time_ms) > DEGRADED_THRESHOLD_MS
  );

  const down = active.filter((monitor) => monitor.status === 'DOWN');

  const noResponseTime = active.filter(
    (monitor) =>
      monitor.status === 'UP' &&
      (
        monitor.response_time_ms == null ||
        !Number.isFinite(Number(monitor.response_time_ms))
      )
  );

  const unknown = active.filter(
    (monitor) => monitor.status !== 'UP' && monitor.status !== 'DOWN'
  );

  const renderSection = (title, items) => {
    if (items.length === 0) return null;

    return (
      <section key={title}>
        <div className="border-b border-[#2a2a2a] bg-[#151515] px-6 py-3">
          <h3 className="font-semibold text-gray-300">
            {title} ({items.length})
          </h3>
        </div>

        <div className="divide-y divide-[#252525]">
          {items.map((monitor) => (
<MonitorCard
  key={monitor.id}
  monitor={monitor}
  timeRange={timeRange}
              onEdit={onEdit}
              onTogglePause={onTogglePause}
              onRotateHeartbeatToken={onRotateHeartbeatToken}
              heartbeatRotationPopup={heartbeatRotationPopup}
onDismissHeartbeatRotationPopup={onDismissHeartbeatRotationPopup}
              onDelete={onDelete}
              onConfirmDelete={onConfirmDelete}
              deleteTarget={deleteTarget}
              onCancelDelete={onCancelDelete}
              busy={busyMonitorId === monitor.id}
            />
          ))}
        </div>
      </section>
    );
  };

  return (
    <div className="overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#1a1a1a]">
      <div className="border-b border-[#2a2a2a] px-6 py-4">
        <h2 className="text-xl font-semibold">Monitors</h2>
      </div>

      {renderSection('Healthy', healthy)}
      {renderSection('Degraded', degraded)}
      {renderSection('Down', down)}
      {renderSection('Response time unavailable', noResponseTime)}
      {renderSection('Awaiting first check', unknown)}
      {renderSection('Paused', paused)}
    </div>
  );
}

export default MonitorList;
