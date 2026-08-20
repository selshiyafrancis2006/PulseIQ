export default function ServiceTimeline({ timeline = [] }) {
  const getColor = (status) => {
    switch (status) {
      case "Healthy":
        return "bg-emerald-500";
      case "Degraded":
        return "bg-yellow-500";
      case "Down":
        return "bg-red-500";
      default:
        return "bg-gray-700";
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
  <p className="text-sm font-medium text-gray-300">
    Health Timeline
  </p>

  <p className="text-xs text-gray-500">
    Last 12 checks
  </p>
</div>

      <div className="flex gap-1">
        {timeline.map((status, index) => (
          <div
            key={index}
            title={status}
            className={`h-6 flex-1 rounded-sm ${getColor(status)}`}
          />
        ))}
      </div>

      <div className="flex justify-between mt-2 text-xs text-gray-500">
        <span>24h ago</span>
        <span>Now</span>
      </div>
    </div>
  );
}