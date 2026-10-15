import LogCard from "./LogCard";

export default function LogsStream({
  logs,
  selectedLog,
  onSelect,
}) {
  if (!logs.length) {
    return (
      <div className="flex h-[600px] items-center justify-center rounded-xl border border-zinc-800 bg-[#111111]">
        <p className="text-zinc-500">
          No logs found.
        </p>
      </div>
    );
  }

  return (
    <div className="h-[600px] overflow-y-auto rounded-xl border border-zinc-800 bg-[#111111]">
      <div className="divide-y divide-zinc-800">
        {logs.map((log) => (
          <LogCard
            key={log.id}
            log={log}
            selected={
              selectedLog?.id === log.id
            }
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}