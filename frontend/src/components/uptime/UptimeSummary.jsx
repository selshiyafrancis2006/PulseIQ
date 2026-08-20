function UptimeSummary({ monitors }) {
  const totalMonitors = monitors.length;

  const healthyMonitors = monitors.filter(
    (monitor) => monitor.status === 'UP'
  ).length;

  const downMonitors = monitors.filter(
    (monitor) => monitor.status === 'DOWN'
  ).length;

  const totalResponseTime = monitors.reduce(
    (sum, monitor) => sum + (monitor.response_time_ms ?? 0),
    0
  );

  const avgResponseTime =
    totalMonitors > 0
      ? Math.round(totalResponseTime / totalMonitors)
      : 0;

  const cards = [
    {
      title: 'Total Monitors',
      value: totalMonitors,
      color: 'text-emerald-400',
    },
    {
      title: 'Healthy',
      value: healthyMonitors,
      color: 'text-emerald-400',
    },
    {
      title: 'Down',
      value: downMonitors,
      color: downMonitors > 0 ? 'text-red-400' : 'text-emerald-400',
    },
    {
      title: 'Avg Response',
      value: `${avgResponseTime} ms`,
      color:
        avgResponseTime < 200
          ? 'text-emerald-400'
          : avgResponseTime < 500
          ? 'text-yellow-400'
          : 'text-red-400',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 mb-8">
      {cards.map((card) => (
        <div
          key={card.title}
          className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6"
        >
          <p className="text-sm uppercase tracking-wide text-gray-400">
            {card.title}
          </p>

          <h2 className={`text-3xl font-bold mt-3 ${card.color}`}>
            {card.value}
          </h2>
        </div>
      ))}
    </div>
  );
}

export default UptimeSummary;