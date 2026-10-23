
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis
} from 'recharts';

function ResponseTimeChart({ data }) {
const chartData = data
    .map((item) => ({
      time: item.checked_at,
      value: item.response_time_ms == null
        ? null
        : Number(item.response_time_ms),
    }));

  return (
    <div className="w-32 h-10">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <XAxis dataKey="time" hide />

          <Tooltip
            formatter={(value) =>
              value == null
                ? ['No response recorded', 'Response Time']
                : [`${value} ms`, 'Response Time']
            }
            labelFormatter={(label) =>
              new Date(label).toLocaleTimeString()
            }
          />

          <Line
            type="monotone"
            dataKey="value"
            stroke="#34d399"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default ResponseTimeChart;
