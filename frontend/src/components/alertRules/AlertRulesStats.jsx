export default function AlertRulesStats({ rules = [] }) {

  const activeRules = rules.filter(
    rule => rule.is_active
  ).length;

  const inactiveRules = rules.length - activeRules;

  const highestThreshold = rules.length
    ? Math.max(
        ...rules.map(rule => rule.threshold)
      )
    : 0;

  const averageThreshold = rules.length
    ? (
        rules.reduce(
          (sum, rule) => sum + rule.threshold,
          0
        ) / rules.length
      ).toFixed(1)
    : 0;

  const stats = [
    {
      title: "Active Rules",
      value: activeRules,
      color: "text-emerald-400"
    },
    {
      title: "Disabled Rules",
      value: inactiveRules,
      color: "text-emerald-400"
    },
    {
      title: "Highest Threshold",
      value: `${highestThreshold}%`,
      color: "text-emerald-400"
    },
    {
      title: "Average Threshold",
      value: `${averageThreshold}%`,
      color: "text-emerald-400"
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
      {stats.map((stat) => (
        <div
          key={stat.title}
          className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5"
        >
          <p className="text-sm text-gray-400">
            {stat.title}
          </p>

          <p className={`text-3xl font-bold mt-2 ${stat.color}`}>
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  );
}