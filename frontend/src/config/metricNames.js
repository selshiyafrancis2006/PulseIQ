export const METRICS = {
  cpu_usage: {
    name: "CPU Usage",
    description:
      "Triggers when CPU usage exceeds the configured threshold.",
    unit: "%",
  },

  memory_usage: {
    name: "Memory Usage",
    description:
      "Triggers when memory usage exceeds the configured threshold.",
      unit: "%",
  },

  disk_usage: {
    name: "Disk Usage",
    description:
      "Triggers when disk usage exceeds the configured threshold.",
      unit: "%",
  },

  network_in: {
    name: "Incoming Network",
    description:
      "Triggers when incoming network traffic exceeds the configured threshold.",
      unit: "Mb/s",
  },

  network_out: {
    name: "Outgoing Network",
    description:
      "Triggers when outgoing network traffic exceeds the configured threshold.",
      unit: "Mb/s", 
  }
};