export default function ServiceHealthSummary({
  totalServices,
  healthyServices,
  degradedServices,
  downServices,
  overallHealth,
}) {
const summaryCards = [
  {
    title: "Total Services",
    value: totalServices,
    subtitle: "Monitored",
    valueColor: "text-emerald-400",
    borderColor: "hover:border-emerald-500",
  },
  {
    title: "Healthy",
    value: healthyServices,
    subtitle: "Operational",
    valueColor: "text-emerald-400",
    borderColor: "hover:border-emerald-500",
  },
  {
    title: "Degraded",
    value: degradedServices,
    subtitle: "Performance Issues",
    valueColor: "text-emerald-400",
    borderColor: "hover:border-emerald-500",
  },
  {
    title: "Down",
    value: downServices,
    subtitle: "Unavailable",
    valueColor: "text-emerald-400",
    borderColor: "hover:border-emerald-500",
  },
  {
    title: "Overall Health",
    value: `${overallHealth}%`,
    subtitle: "System Score",
    valueColor: "text-emerald-400",
    borderColor: "hover:border-emerald-500",
  },
];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-5">
      {summaryCards.map((card) => {

        return (
          <div
            key={card.title}
            className="bg-[#161B22] border border-gray-800 rounded-xl p-5 hover:border-emerald-500 transition-all duration-200"
          >
            <div className="flex items-center justify-between">
              <p className="text-gray-400 text-sm">{card.title}</p>
            </div>

            <h2
  className={`text-3xl font-bold mt-4 ${
    card.valueColor || "text-white"
  }`}
>
  {card.value}
</h2>

<p className="text-xs text-gray-500 mt-2">
  {card.subtitle}
</p>
          </div>
        );
      })}
    </div>
  );
}