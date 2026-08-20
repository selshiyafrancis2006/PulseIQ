export function filterAlertRules(
  rules,
  search,
  filter,
  severity
) {

  return rules.filter(rule => {

    const matchesSearch =
      rule.metric_name
        .toLowerCase()
        .includes(search.toLowerCase());

    const matchesFilter =
      filter === "all"
        ? true
        : filter === "enabled"
        ? rule.is_active
        : !rule.is_active;

    const matchesSeverity =
      severity === "all"
        ? true
        : rule.severity === severity;

    return (
      matchesSearch &&
      matchesFilter &&
      matchesSeverity
    );

  });

}