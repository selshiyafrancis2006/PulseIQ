import { useCallback, useEffect, useState } from "react";
import api from "../services/api";

export default function useHosts() {
  const [hosts, setHosts] = useState([]);
  const [selectedHostId, setSelectedHostId] = useState(null);
  const [tagFilter, setTagFilter] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchHosts = useCallback(async (filterTag) => {
    try {
      const params = filterTag ? { tag: filterTag } : {};
      const { data } = await api.get("/hosts", { params });
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
    fetchHosts(tagFilter);
  }, [fetchHosts, tagFilter]);

  const registerHost = async (name, tags = []) => {
    const { data } = await api.post("/hosts/register", { name, tags });

    // non-secret fields only, matching what GET /hosts returns
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

    return data; // caller needs the one-time api_key
  };

  // Rename and/or re-tag. Refetches so sorting and the active tag filter
  // are applied by the server, not guessed locally.
  const updateHost = async (id, { name, tags }) => {
    const { data } = await api.patch(`/hosts/${id}`, { name, tags });
    await fetchHosts(tagFilter);
    return data;
  };

  // Returns { id, name, api_key }; the old key stops working immediately.
  const regenerateKey = async (id) => {
    const { data } = await api.post(`/hosts/${id}/regenerate-key`);
    return data;
  };

  // Refetching also moves the selection if the deleted host was selected.
  const deleteHost = async (id) => {
    await api.delete(`/hosts/${id}`);
    await fetchHosts(tagFilter);
  };

  return {
    hosts,
    selectedHostId,
    setSelectedHostId,
    tagFilter,
    setTagFilter,
    loading,
    registerHost,
    updateHost,
    regenerateKey,
    deleteHost,
    refetch: fetchHosts,
  };
}