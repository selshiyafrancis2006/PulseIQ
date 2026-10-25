import { useCallback, useEffect, useState } from "react";
import api from "../services/api";

export function getErrorMessage(err, fallback) {
  return (
    err.response?.data?.message ||
    err.response?.data?.error ||
    fallback
  );
}

export default function useNotificationChannels() {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchChannels = useCallback(async () => {
    try {
      const { data } = await api.get("/notification-channels");
      setChannels(data);
      setError("");
    } catch (err) {
      console.error("Failed to load notification channels:", err);
      setError("Unable to load notification channels.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  const createChannel = async ({ type, name, url }) => {
    const { data } = await api.post("/notification-channels", {
      type,
      name,
      url,
    });
    setChannels((prev) => [...prev, data]);
    return data;
  };

  const setChannelActive = async (id, isActive) => {
    const { data } = await api.patch(`/notification-channels/${id}`, {
      is_active: isActive,
    });
    setChannels((prev) => prev.map((c) => (c.id === id ? data : c)));
    return data;
  };

  const deleteChannel = async (id) => {
    await api.delete(`/notification-channels/${id}`);
    setChannels((prev) => prev.filter((c) => c.id !== id));
  };

  // Resolves to { ok, message } instead of throwing, so the UI can show
  // the result inline next to the channel.
  const testChannel = async (id) => {
    try {
      await api.post(`/notification-channels/${id}/test`);
      return { ok: true, message: "Test notification sent" };
    } catch (err) {
      return {
        ok: false,
        message: getErrorMessage(err, "Test failed"),
      };
    }
  };

  return {
    channels,
    loading,
    error,
    createChannel,
    setChannelActive,
    deleteChannel,
    testChannel,
  };
}