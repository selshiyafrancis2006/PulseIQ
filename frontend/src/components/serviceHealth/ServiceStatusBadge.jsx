import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "lucide-react";

export default function ServiceStatusBadge({ status }) {
  const config = {
    Healthy: {
      icon: CheckCircle2,
      text: "Healthy",
      className:
        "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
    },
    Degraded: {
      icon: AlertTriangle,
      text: "Degraded",
      className:
        "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20",
    },
    Down: {
      icon: XCircle,
      text: "Down",
      className:
        "bg-red-500/10 text-red-400 border border-red-500/20",
    },
  };

  const badge = config[status] || config.Down;
  const Icon = badge.icon;

  return (
    <span
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${badge.className}`}
    >
      <Icon size={16} />
      {badge.text}
    </span>
  );
}