import { useState, useEffect, useCallback } from "react";

export default function useServiceHealth() {
  const [services, setServices] = useState([]);
  const [summary, setSummary] = useState({
    totalServices: 0,
    healthyServices: 0,
    degradedServices: 0,
    downServices: 0,
    overallHealth: 0,
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchServiceHealth = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      // TODO: Replace with your backend API
      // const response = await fetch("http://localhost:5000/api/service-health");
      // const data = await response.json();

      // Dummy data
      const data = {
        services: [
          {
            id: 1,
            name: "Authentication API",
            description: "Handles user authentication",
            status: "Healthy",
            uptime: "99.99%",
            responseTime: "42 ms",
            errorRate: "0.02%",
            lastIncident: "12 days ago",
            healthScore: 99,
            timeline: [
              "Healthy",
              "Healthy",
              "Healthy",
              "Healthy",
              "Healthy",
              "Healthy",
              "Healthy",
              "Healthy",
              "Healthy",
              "Healthy",
              "Healthy",
              "Healthy",
            ],
          },
          {
            id: 2,
            name: "Alert Engine",
            description: "Processes monitoring alerts",
            status: "Degraded",
            uptime: "98.4%",
            responseTime: "185 ms",
            errorRate: "1.8%",
            lastIncident: "30 mins ago",
            healthScore: 83,
            timeline: [
              "Healthy",
              "Healthy",
              "Healthy",
              "Degraded",
              "Degraded",
              "Healthy",
              "Healthy",
              "Healthy",
              "Healthy",
              "Healthy",
              "Healthy",
              "Healthy",
            ],
          },
          {
            id: 3,
            name: "Notification Service",
            description: "Email & Slack notifications",
            status: "Down",
            uptime: "94.2%",
            responseTime: "--",
            errorRate: "12%",
            lastIncident: "Now",
            healthScore: 58,
            timeline: [
              "Healthy",
              "Healthy",
              "Healthy",
              "Healthy",
              "Down",
              "Down",
              "Down",
              "Down",
              "Down",
              "Down",
              "Down",
              "Down",
            ],
          },
        ],
      };

      setServices(data.services);

      const total = data.services.length;
      const healthy = data.services.filter(
        (s) => s.status === "Healthy"
      ).length;

      const degraded = data.services.filter(
        (s) => s.status === "Degraded"
      ).length;

      const down = data.services.filter(
        (s) => s.status === "Down"
      ).length;

      const overallHealth =
        total === 0
          ? 0
          : Math.round(
              data.services.reduce(
                (sum, service) => sum + service.healthScore,
                0
              ) / total
            );

      setSummary({
        totalServices: total,
        healthyServices: healthy,
        degradedServices: degraded,
        downServices: down,
        overallHealth,
      });
    } catch (err) {
      console.error(err);
      setError("Failed to load service health.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServiceHealth();

    const interval = setInterval(fetchServiceHealth, 30000);

    return () => clearInterval(interval);
  }, [fetchServiceHealth]);

  return {
    services,
    summary,
    loading,
    error,
    refresh: fetchServiceHealth,
  };
}