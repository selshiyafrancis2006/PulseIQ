import { useEffect, useState } from "react";
import api from "../services/api";

export default function useLogs() {
  const [logs, setLogs] = useState([]);

  const [summary, setSummary] = useState({
    totalLogs: 0,
    errors: 0,
    warnings: 0,
    info: 0,
    avgPerSecond: 0,
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchLogs = async () => {
    try {
      setLoading(true);

      const { data } = await api.get("/logs");

      setLogs(data);

      const errors = data.filter(
        (log) => log.level === "ERROR"
      ).length;

      const warnings = data.filter(
        (log) => log.level === "WARN"
      ).length;

      const info = data.filter(
        (log) => log.level === "INFO"
      ).length;

      // Average logs per second over the selected dataset
      let avgPerSecond = 0;

      if (data.length > 1) {
        const newest = new Date(
          data[0].created_at
        ).getTime();

        const oldest = new Date(
          data[data.length - 1].created_at
        ).getTime();

        const seconds = Math.max(
          (newest - oldest) / 1000,
          1
        );

        avgPerSecond = Number(
          (data.length / seconds).toFixed(2)
        );
      }

      setSummary({
        totalLogs: data.length,
        errors,
        warnings,
        info,
        avgPerSecond,
      });

      setError("");
    } catch (err) {
      console.error(err);

      setError("Failed to load logs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();

    const interval = setInterval(fetchLogs, 5000);

    return () => clearInterval(interval);
  }, []);

  return {
    logs,
    summary,
    loading,
    error,
    refresh: fetchLogs,
  };
}