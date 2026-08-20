import { HeartPulse } from "lucide-react";

export default function HealthScoreCard({
  score = 98,
  healthy = 9,
  total = 10,
}) {
  const getScoreColor = () => {
    if (score >= 95) return "text-emerald-400";
    if (score >= 80) return "text-yellow-400";
    return "text-red-400";
  };

  const getStatus = () => {
    if (score >= 95) return "Excellent";
    if (score >= 80) return "Good";
    return "Needs Attention";
  };

  return (
    <div className="bg-[#161B22] border border-gray-800 rounded-xl p-6 flex flex-col items-center hover:border-emerald-500 transition-all duration-200">

      <HeartPulse className={`w-10 h-10 mb-4 ${getScoreColor()}`} />

      <p className="text-gray-400 text-sm">
        Overall Health Score
      </p>

      <h2 className={`text-5xl font-bold mt-3 ${getScoreColor()}`}>
        {score}%
      </h2>

      <span
        className={`mt-3 px-3 py-1 rounded-full text-sm font-medium ${getScoreColor()} bg-white/5`}
      >
        {getStatus()}
      </span>

      <div className="w-full border-t border-gray-800 mt-6 pt-4 text-center">
        <p className="text-gray-400 text-sm">
          Healthy Services
        </p>

        <p className="text-lg font-semibold text-white mt-1">
          {healthy} / {total}
        </p>
      </div>
    </div>
  );
}