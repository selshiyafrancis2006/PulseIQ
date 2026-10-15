export default function LogDetails({ log }) {
  if (!log) {
    return (
      <div className="flex h-[600px] items-center justify-center rounded-xl border border-zinc-800 bg-[#111111]">
        <p className="text-zinc-500">
          Select a log to inspect its details.
        </p>
      </div>
    );
  }

  const metadata = [
    { label: "Timestamp", value: log.timestamp },
    { label: "Severity", value: log.level },
    { label: "Service", value: log.service },
    { label: "Source", value: log.source },
    { label: "Host", value: log.host },
    { label: "IP Address", value: log.ip },
    { label: "Process ID", value: log.pid },
  ];

  return (
    <div className="h-[600px] overflow-y-auto rounded-xl border border-zinc-800 bg-[#111111]">
      {/* Header */}
      <div className="border-b border-zinc-800 p-5">
        <h2 className="text-base font-semibold text-white">
  Log Details
</h2>
      </div>

      {/* Message */}
      <div className="border-b border-zinc-800 p-5">
        <p className="mb-2 text-xs uppercase tracking-wider text-zinc-500">
          Message
        </p>

        <pre className="whitespace-pre-wrap break-words rounded-lg bg-zinc-950 p-3 font-mono text-xs text-emerald-400">
          {log.message}
        </pre>
      </div>

      {/* Metadata */}
      <div className="p-5">
        <h3 className="mb-4 text-sm font-semibold text-zinc-300">
          Metadata
        </h3>

        <div className="space-y-3">
          {metadata.map((item) => (
            <div
              key={item.label}
              className="flex items-start justify-between gap-4 border-b border-zinc-800 pb-3"
            >
              <span className="text-sm text-zinc-500">
                {item.label}
              </span>

              <span className="break-all text-right text-sm text-white">
                {item.value || "-"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Raw JSON */}
      <div className="border-t border-zinc-800 p-5">
        <h3 className="mb-3 text-sm font-semibold text-zinc-300">
          Raw Log
        </h3>

        <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-4 text-xs text-emerald-400">
          {JSON.stringify(log, null, 2)}
        </pre>
      </div>
    </div>
  );
}