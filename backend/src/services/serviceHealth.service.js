const si = require("systeminformation");

async function getServiceHealth() {

  const cpu = await si.currentLoad();

  const memory = await si.mem();

  const memoryUsage = Number(
    (
      (memory.used / memory.total) * 100
    ).toFixed(2)
  );


  const healthScore =
    100 -
    (
      cpu.currentLoad > 80 ? 20 : 0
    ) -
    (
      memoryUsage > 90 ? 30 : 0
    );

    const status =
  healthScore >= 90
    ? "Healthy"
    : healthScore >= 70
    ? "Degraded"
    : "Down";

    const services = [
  {
    name: "System Resources",
    description: "CPU and memory monitoring",
    status,
    uptime: "Running",
    responseTime: `${cpu.currentLoad.toFixed(0)} ms`,
    errorRate: "0%",
    lastIncident: "None",
    healthScore,
    timeline: [
      status,
      status,
      status,
      status,
      status,
    ],
  },
];

  return {
    cpuUsage: Number(cpu.currentLoad.toFixed(2)),

    memoryUsage,

    healthScore,

    status,

  summary: {
    totalServices: services.length,

    healthyServices: services.filter(
      s => s.status === "Healthy"
    ).length,

    degradedServices: services.filter(
      s => s.status === "Degraded"
    ).length,

    downServices: services.filter(
      s => s.status === "Down"
    ).length,

    overallHealth: healthScore,
  },

  services,

  };

}

module.exports = {
  getServiceHealth,
};