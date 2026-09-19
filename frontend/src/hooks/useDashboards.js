import { useCallback, useEffect, useState } from "react";
import api from "../services/api";

export default function useDashboards() {
  const [dashboards, setDashboards] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchDashboards = useCallback(async () => {
    try {
      const { data } = await api.get("/dashboards");
      setDashboards(data);
    } catch (err) {
      console.error("Failed to load dashboards:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboards();
  }, [fetchDashboards]);

  const createDashboard = async (name) => {
    const { data } = await api.post("/dashboards", { name });
    setDashboards((prev) => [...prev, data]);
    return data;
  };

  const renameDashboard = async (id, name) => {
    const { data } = await api.patch(`/dashboards/${id}`, { name });
    setDashboards((prev) => prev.map((d) => (d.id === id ? data : d)));
    return data;
  };

  const deleteDashboard = async (id) => {
    await api.delete(`/dashboards/${id}`);
    setDashboards((prev) => prev.filter((d) => d.id !== id));
  };

  return {
    dashboards,
    loading,
    createDashboard,
    renameDashboard,
    deleteDashboard,
    refetch: fetchDashboards,
  };
}