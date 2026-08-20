import { useMemo, useState } from "react";

import useLogs from "../hooks/useLogs";

import LogsToolbar from "../components/logs/LogsToolbar";
import LogsFilters from "../components/logs/LogsFilters";
import LogsStream from "../components/logs/LogsStream";
import LogDetails from "../components/logs/LogDetails";

export default function Logs() {
  const {
    logs,
    loading,
    error,
    refresh,
  } = useLogs();

  const [search, setSearch] = useState("");
  const [timeRange, setTimeRange] = useState("15m");
  const [liveMode, setLiveMode] = useState(true);

  const [level, setLevel] = useState("ALL");
  const [service, setService] = useState("");
  const [source, setSource] = useState("");

  const [selectedLog, setSelectedLog] = useState(null);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchesSearch =
        search === "" ||
        log.message
          ?.toLowerCase()
          .includes(search.toLowerCase()) ||
        log.service
          ?.toLowerCase()
          .includes(search.toLowerCase()) ||
        log.source
          ?.toLowerCase()
          .includes(search.toLowerCase());

      const matchesLevel =
        level === "ALL" ||
        log.level === level;

      const matchesService =
        service === "" ||
        log.service
          ?.toLowerCase()
          .includes(service.toLowerCase());

      const matchesSource =
        source === "" ||
        log.source
          ?.toLowerCase()
          .includes(source.toLowerCase());

      return (
        matchesSearch &&
        matchesLevel &&
        matchesService &&
        matchesSource
      );
    });
  }, [
    logs,
    search,
    level,
    service,
    source,
  ]);

  if (error) {
    return (
      <div className="py-10 text-center text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6 text-white">

      <div>
        <h1 className="text-3xl font-bold">
          Logs Explorer
        </h1>

        <p className="mt-1 text-gray-400">
          Search and inspect logs across your services.
        </p>
      </div>

      <LogsToolbar
        search={search}
        setSearch={setSearch}
        timeRange={timeRange}
        setTimeRange={setTimeRange}
        liveMode={liveMode}
        setLiveMode={setLiveMode}
        onRefresh={refresh}
      />

      <div className="grid grid-cols-12 gap-6">

        <div className="col-span-3">
          <LogsFilters
            level={level}
            setLevel={setLevel}
            service={service}
            setService={setService}
            source={source}
            setSource={setSource}
          />
        </div>

        <div className="col-span-6">
          <LogsStream
            logs={filteredLogs}
            selectedLog={selectedLog}
            onSelect={setSelectedLog}
          />
        </div>

        <div className="col-span-3">
          <LogDetails
            log={selectedLog}
          />
        </div>

      </div>
    </div>
  );
}