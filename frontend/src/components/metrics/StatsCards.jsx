export default function StatsCards({
  metrics,
  selectedMetric
}) {

  if (!metrics.length) return null;

console.log('Selected Metric:', selectedMetric);
console.log('First Metric Object:', metrics[0]);
console.log('Value:', metrics[0][selectedMetric]);

  const values = metrics.map(metric =>
    parseFloat(metric[selectedMetric])
  );

  const latest = values[values.length - 1];

  const average =
    values.reduce((sum, value) => sum + value, 0) /
    values.length;

  const maximum = Math.max(...values);

  const minimum = Math.min(...values);

  const stats = [
    {
      label: 'Latest',
      value: latest
    },
    {
      label: 'Average',
      value: average
    },
    {
      label: 'Maximum',
      value: maximum
    },
    {
      label: 'Minimum',
      value: minimum
    }
  ];

  return (

    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">

      {stats.map((stat) => (

        <div
          key={stat.label}
          className="
            bg-[#1a1a1a]
            border
            border-[#2a2a2a]
            rounded-xl
            p-5
          "
        >

          <p className="text-xs uppercase tracking-widest text-gray-500 mb-2">
            {stat.label}
          </p>

          <h2 className="text-3xl font-bold text-emerald-400">
            {stat.value.toFixed(2)}
          </h2>

        </div>

      ))}

    </div>

  );

}