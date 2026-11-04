export const METRICS = {
  cpu_usage: {
    name: "CPU Usage",
    description:
      "Triggers when CPU usage exceeds the configured threshold.",
    thresholds: { warning: 75, critical: 90 },
    unit: "%",
  },

  memory_usage: {
    name: "Memory Usage",
    description:
      "Triggers when memory usage exceeds the configured threshold.",
      thresholds: { warning: 75, critical: 90 },
    unit: "%",
  },

  disk_usage: {
    name: "Disk Usage",
    description:
      "Triggers when disk usage exceeds the configured threshold.",
      thresholds: { warning: 75, critical: 90 },
    unit: "%",
  },

  network_in: {
    name: "Incoming Network",
    description:
      "Triggers when incoming network traffic exceeds the configured threshold.",
      thresholds: null,
    unit: "KB/s",
  },

  network_out: {
    name: "Outgoing Network",
    description:
      "Triggers when outgoing network traffic exceeds the configured threshold.",
      thresholds: null,
    unit: "KB/s", 
  }
};


