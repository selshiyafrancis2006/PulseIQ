import { describe, expect, test, vi } from 'vitest'

vi.mock('./metricFormatting', () => ({
  formatMetricValue: (metric, value) => `${metric}: ${value}`
}))

import { buildEventDatasets } from './chartEvents'

const points = [
  { timestamp: 1000, metric: { cpu_usage: 20 } },
  { timestamp: 2000, metric: { cpu_usage: 40 } },
  { timestamp: 3000, metric: { cpu_usage: 60 } }
]

const common = {
  selectedMetrics: ['cpu_usage'],
  points,
  readValue: (point, metric) => point.metric?.[metric] ?? null,
  getAxisId: () => 'y'
}

describe('buildEventDatasets', () => {
  test('places alert markers on the matching metric point', () => {
    const result = buildEventDatasets({
      ...common,
      alerts: [{
        metric_name: 'cpu_usage',
        timestamp: new Date(2000).toISOString(),
        severity: 'Critical',
        current_value: 40,
        threshold_value: 30
      }],
      anomalies: []
    })

    expect(result).toHaveLength(1)
    expect(result[0].label).toBe('Alerts')
    expect(result[0].data).toEqual([null, 40, null])
    expect(result[0].eventDetails[1][0]).toContain('Critical')
  })

  test('places anomaly markers and includes deviation score', () => {
    const result = buildEventDatasets({
      ...common,
      alerts: [],
      anomalies: [{
        metric_name: 'cpu_usage',
        timestamp: new Date(3000).toISOString(),
        value: 60,
        deviation_score: 3.5
      }]
    })

    expect(result).toHaveLength(1)
    expect(result[0].label).toBe('Anomalies')
    expect(result[0].data).toEqual([null, null, 60])
    expect(result[0].eventDetails[2][0]).toContain('3.5')
  })

  test('ignores events belonging to another metric', () => {
    const result = buildEventDatasets({
      ...common,
      alerts: [{
        metric_name: 'memory_usage',
        timestamp: new Date(2000).toISOString(),
        current_value: 40,
        threshold_value: 30
      }],
      anomalies: []
    })

    expect(result).toHaveLength(0)
  })

  test('ignores events outside the chart time range', () => {
    const result = buildEventDatasets({
      ...common,
      alerts: [{
        metric_name: 'cpu_usage',
        timestamp: new Date(100000).toISOString(),
        current_value: 40,
        threshold_value: 30
      }],
      anomalies: []
    })

    expect(result).toHaveLength(0)
  })

  test('ignores events when the nearest chart point has no metric value', () => {
    const result = buildEventDatasets({
      ...common,
      points: [
        { timestamp: 1000, metric: { cpu_usage: 20 } },
        { timestamp: 2000, metric: null },
        { timestamp: 3000, metric: { cpu_usage: 60 } }
      ],
      alerts: [{
        metric_name: 'cpu_usage',
        timestamp: new Date(2000).toISOString(),
        current_value: 40,
        threshold_value: 30
      }],
      anomalies: []
    })

    expect(result).toHaveLength(0)
  })

  test('returns no datasets when there are no events', () => {
    expect(buildEventDatasets({
      ...common,
      alerts: [],
      anomalies: []
    })).toEqual([])
  })
})
