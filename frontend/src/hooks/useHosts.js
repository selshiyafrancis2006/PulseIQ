import { useCallback, useEffect, useState } from "react";
import api from "../services/api";

export default function useHosts() {
  const [hosts, setHosts] = useState([]);
  const [selectedHostId, setSelectedHostId] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchHosts = useCallback(async () => {
    try {
      const { data } = await api.get("/hosts");
      setHosts(data);

      setSelectedHostId((current) => {
        if (current !== null && data.some((h) => h.id === current)) {
          return current;
        }
        return data.length > 0 ? data[0].id : null;
      });
    } catch (err) {
      console.error("Failed to load hosts:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHosts();
  }, [fetchHosts]);

  const registerHost = async (name) => {
    const { data } = await api.post("/hosts/register", { name });

    // data includes the one-time api_key; only non-secret fields go into
    // list state, matching the shape GET /hosts returns
    setHosts((prev) => [
      ...prev,
      {
        id: data.id,
        name: data.name,
        created_at: data.created_at,
        last_seen_at: null,
      },
    ]);

    setSelectedHostId((current) => current ?? data.id);

    return data; // caller needs the api_key for the one-time reveal
  };

  return {
    hosts,
    selectedHostId,
    setSelectedHostId,
    loading,
    registerHost,
    refetch: fetchHosts,
  };
}