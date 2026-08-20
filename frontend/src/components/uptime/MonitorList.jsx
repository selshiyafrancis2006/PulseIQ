import MonitorCard from './MonitorCard';

function MonitorList({ monitors, loading }) {
  if (loading) {
    return (
      <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl">
        <div className="p-6 text-gray-400">
          Loading monitors...
        </div>
      </div>
    );
  }

  if (monitors.length === 0) {
    return (
      <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl">
        <div className="p-6 text-gray-400">
          No monitors configured.
        </div>
      </div>
    );
  }

  const healthy = monitors.filter(
    (m) => m.status === 'UP' && (m.response_time_ms ?? 0) <= 500
  );

  const degraded = monitors.filter(
    (m) => m.status === 'UP' && (m.response_time_ms ?? 0) > 500
  );

  const down = monitors.filter(
    (m) => m.status === 'DOWN'
  );

  const renderSection = (title, items) => {
    if (items.length === 0) return null;

    return (
      <div>
        <div className="px-6 py-3 bg-[#151515] border-b border-[#2a2a2a]">
          <h3 className="font-semibold text-gray-300">
            {title} ({items.length})
          </h3>
        </div>

        {items.map((monitor) => (
          <MonitorCard
            key={monitor.id}
            monitor={monitor}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden">

      <div className="px-6 py-4 border-b border-[#2a2a2a]">
        <h2 className="text-xl font-semibold">
          Active Monitors
        </h2>
      </div>

      {renderSection('🟢 Healthy', healthy)}
      {renderSection('🟡 Degraded', degraded)}
      {renderSection('🔴 Down', down)}

    </div>
  );
}

export default MonitorList;