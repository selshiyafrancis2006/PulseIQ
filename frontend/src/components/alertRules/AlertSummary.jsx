export default function AlertSummary({ summary }) {

  const items = [
    {
      label: "Showing",
      value: summary.total,
      color: "text-emerald-400"
    },
    {
      label: "Enabled",
      value: summary.enabled,
      color: "text-emerald-400"
    },
    {
      label: "Disabled",
      value: summary.disabled,
      color: "text-emerald-400"
    },
    {
      label: "Critical",
      value: summary.critical,
      color: "text-emerald-500"
    },
    {
      label: "Warning",
      value: summary.warning,
      color: "text-emerald-400"
    },
    {
      label: "Info",
      value: summary.info,
      color: "text-emerald-400"
    }
  ];

  return (

    <div className="flex flex-wrap gap-3 mb-6">

      {items.map(item => (

        <div
          key={item.label}
          className="
            bg-[#1a1a1a]
            border border-[#2a2a2a]
            rounded-lg
            px-4
            py-2
          "
        >

          <p className="text-xs text-gray-500">
            {item.label}
          </p>

          <p className={`font-semibold ${item.color}`}>
            {item.value}
          </p>

        </div>

      ))}

    </div>

  );

}