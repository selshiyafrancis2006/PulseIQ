import { formatMetricValue } from './metricFormatting'

// Alert and anomaly markers for the metrics chart. Each marker sits on the
// line of the metric it belongs to.

const DEFAULT_SLACK_MS = 60 * 1000

const describeAlert = (alert) =>
  `Alert (${alert.severity || 'Warning'}): ` +
  `${formatMetricValue(alert.metric_name, alert.current_value)} ` +
  `vs threshold ${formatMetricValue(alert.metric_name, alert.threshold_value)}`

const describeAnomaly = (anomaly) => {
  const score = Number(anomaly.deviation_score)

  return (
    `Anomaly: ${formatMetricValue(anomaly.metric_name, anomaly.value)}` +
    (Number.isFinite(score) ? ` (${score.toFixed(1)}\u03c3 from baseline)` : '')
  )
}

// One value per chart point (null where there is no marker) plus the tooltip
// lines of each marker. Events outside the chart's time range, or on a gap in
// the data, are left out.
function placeEvents({ events, points, metricKey, readValue, describe }) {
  const data = points.map(() => null)
  const details = points.map(() => null)

  if (!Array.isArray(events) || events.length === 0 || points.length === 0) {
    return { data, details, count: 0 }
  }

  const times = points.map((point) => point.timestamp)
  const gaps = times
    .slice(1)
    .map((time, index) => time - times[index])
    .filter((gap) => gap > 0)
    .sort((a, b) => a - b)
  const slack = gaps.length ? gaps[Math.floor((gaps.length - 1) / 2)] : DEFAULT_SLACK_MS
  let count = 0

  for (const event of events) {
    if (event?.metric_name !== metricKey) continue

    const time = new Date(event.timestamp).getTime()

    if (
      !Number.isFinite(time) ||
      time < times[0] - slack ||
      time > times[times.length - 1] + slack
    ) {
      continue
    }

    let nearest = 0

    times.forEach((pointTime, index) => {
      if (Math.abs(pointTime - time) < Math.abs(times[nearest] - time)) nearest = index
    })

    const value = readValue(points[nearest], metricKey)

    if (value === null) continue

    data[nearest] = value
    details[nearest] = [...(details[nearest] ?? []), describe(event)]
    count += 1
  }

  return { data, details, count }
}

// Chart.js datasets for the alert and anomaly markers of the selected
// metrics. Returns nothing when there is nothing to show.
export function buildEventDatasets({
  alerts,
  anomalies,
  selectedMetrics,
  points,
  readValue,
  getAxisId
}) {
  const kinds = [
    { events: alerts, name: 'Alerts', color: '#ef4444', pointStyle: 'triangle', describe: describeAlert },
    { events: anomalies, name: 'Anomalies', color: '#f97316', pointStyle: 'rectRot', describe: describeAnomaly }
  ]
  const datasets = []

  for (const kind of kinds) {
    for (const metric of selectedMetrics) {
      const { data, details, count } = placeEvents({
        events: kind.events,
        points,
        metricKey: metric,
        readValue,
        describe: kind.describe
      })

      if (count === 0) continue

      datasets.push({
        label:
          selectedMetrics.length === 1
            ? kind.name
            : `${kind.name} \u00b7 ${metric.replace(/_/g, ' ').toUpperCase()}`,
        yAxisID: getAxisId(metric),
        data,
        eventDetails: details,
        showLine: false,
        borderColor: kind.color,
        backgroundColor: kind.color,
        pointStyle: kind.pointStyle,
        pointRadius: 7,
        pointHoverRadius: 9,
        spanGaps: false,
        order: -1
      })
    }
  }

  return datasets
}
