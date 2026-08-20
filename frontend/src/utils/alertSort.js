const severityOrder = {
  critical: 3,
  warning: 2,
  info: 1
};

export function sortAlertRules(rules, sortBy) {

  const sorted = [...rules];

  switch (sortBy) {

    case "threshold-high":
      return sorted.sort((a, b) => b.threshold - a.threshold);

    case "threshold-low":
      return sorted.sort((a, b) => a.threshold - b.threshold);

    case "severity":
      return sorted.sort(
        (a, b) =>
          (severityOrder[b.severity] || 0) -
          (severityOrder[a.severity] || 0)
      );

    case "metric":
    default:
      return sorted.sort((a, b) =>
        a.metric_name.localeCompare(b.metric_name)
      );
  }

}