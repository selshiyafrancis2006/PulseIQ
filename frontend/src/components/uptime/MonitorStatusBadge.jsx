function MonitorStatusBadge({ status }) {
  const statusConfig = {
    UP: {
      label: '🟢 UP',
      className: 'bg-emerald-900/40 text-emerald-400 border border-emerald-700'
    },
    DOWN: {
      label: '🔴 DOWN',
      className: 'bg-red-900/40 text-red-400 border border-red-700'
    }
  };

  const currentStatus = statusConfig[status] || {
    label: '⚪ UNKNOWN',
    className: 'bg-gray-800 text-gray-400 border border-gray-700'
  };

  return (
    <span
      className={`px-4 py-2 rounded-full text-sm font-semibold ${currentStatus.className}`}
    >
      {currentStatus.label}
    </span>
  );
}

export default MonitorStatusBadge;