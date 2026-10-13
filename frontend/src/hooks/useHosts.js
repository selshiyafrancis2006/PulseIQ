
import { useCallback, useEffect, useRef, useState } from "react";
import api from "../services/api";

const HOST_REFRESH_INTERVAL_MS = 10000;

export default function useHosts() {
  const [hosts, setHosts] = useState([]);
  const [selectedHostId, setSelectedHostId] = useState(null);
  const [tagFilter, setTagFilter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);

  const fetchHosts = useCallback(async (filterTag = tagFilter) => {
    const requestId = ++requestIdRef.current;
    const isInitialLoad = !mountedRef.current;

    if (isInitialLoad) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const params = filterTag ? { tag: filterTag } : {};
      const { data } = await api.get("/hosts", { params });

      if (requestId !== requestIdRef.current) return;

      if (!Array.isArray(data)) {
        throw new Error("Invalid hosts response");
      }

      setHosts(data);
      setError("");

      setSelectedHostId((current) => {
        if (current !== null && data.some((host) => host.id === current)) {
          return current;
        }
        return data.length > 0 ? data[0].id : null;
      });
    } catch (err) {
      if (requestId !== requestIdRef.current) return;

      console.error("Failed to load hosts:", err);
      setError(
        err.response?.data?.error ||
          "Unable to load hosts. Check your connection and try again."
      );
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
        mountedRef.current = true;
      }
    }
  }, [tagFilter]);

  useEffect(() => {
    fetchHosts(tagFilter);

    const intervalId = setInterval(() => {
      fetchHosts(tagFilter);
    }, HOST_REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
      requestIdRef.current += 1;
    };
  }, [fetchHosts, tagFilter]);

  const registerHost = async (name, tags = []) => {
    const { data } = await api.post("/hosts/register", { name, tags });

    setHosts((prev) => [
      ...prev,
      {
        id: data.id,
        name: data.name,
        tags: data.tags || [],
        created_at: data.created_at,
        last_seen_at: null,
      },
    ]);

    setSelectedHostId((current) => current ?? data.id);

    return data;
  };

  const updateHost = async (id, { name, tags }) => {
    const { data } = await api.patch(`/hosts/${id}`, { name, tags });
    await fetchHosts(tagFilter);
    return data;
  };

  const regenerateKey = async (id) => {
    const { data } = await api.post(`/hosts/${id}/regenerate-key`);
    return data;
  };

  
const deleteHost = async (id) => {
  await api.delete(`/hosts/${id}`);

  setHosts((prev) => prev.filter((host) => host.id !== id));
  setSelectedHostId((current) => (current === id ? null : current));

  await fetchHosts(tagFilter);
};


  return {
    hosts,
    selectedHostId,
    setSelectedHostId,
    tagFilter,
    setTagFilter,
    loading,
    refreshing,
    error,
    registerHost,
    updateHost,
    regenerateKey,
    deleteHost,
    refetch: fetchHosts,
  };
}
