import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis
} from 'recharts';

function ResponseTimeChart({ data, status, responseTime }) {
    const chartData = data
    .slice()
    .reverse()
    .map((item) => ({
      time: item.checked_at,
      value: item.response_time_ms || 0,
    }));

    const strokeColor =
  status === 'DOWN'
    ? '#ef4444'
    : (responseTime ?? 0) > 1000
    ? '#facc15'
    : '#34d399';

  return (
  <div className="w-32 h-10">
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData}>

  <XAxis
    dataKey="time"
    hide
  />

  <Tooltip
    formatter={(value) => [`${value} ms`, 'Response Time']}
    labelFormatter={(label) =>
      new Date(label).toLocaleTimeString()
    }
  />

  <Line
    type="monotone"
    dataKey="value"
    stroke={strokeColor}
    strokeWidth={2}
    dot={false}
  />

</LineChart>
    </ResponsiveContainer>
  </div>
);
}

export default ResponseTimeChart;