import { useEffect, useState } from "react";
import api from "../services/api";

export default function useHosts() {
  const [hosts, setHosts] = useState([]);
  const [selectedHostId, setSelectedHostId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHosts = async () => {
      try {
        const { data } = await api.get("/hosts");
        setHosts(data);

        if (data.length > 0 && selectedHostId === null) {
          setSelectedHostId(data[0].id);
        }
      } catch (err) {
        console.error("Failed to load hosts:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchHosts();
  }, []);

  return {
    hosts,
    selectedHostId,
    setSelectedHostId,
    loading
  };
}