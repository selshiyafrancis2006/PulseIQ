import { describe, expect, test } from 'vitest'
import {
  buildMetricChartPoints,
  getMetricTimestamp
} from './metricChartData'

const sample = (seconds, cpu = 10) => ({
  timestamp: new Date(seconds * 1000).toISOString(),
  cpu_usage: cpu
})

describe('metricChartData', () => {
  test('prefers collected_at over server receipt timestamp', () => {
    const metric = {
      timestamp: '2026-11-02T15:00:00.000Z',
      collected_at: '2026-11-02T14:58:00.000Z'
    }

    expect(getMetricTimestamp(metric)).toBe(
      new Date(metric.collected_at).getTime()
    )
  })

  test('falls back to timestamp for older metric rows', () => {
    const metric = {
      timestamp: '2026-11-02T15:00:00.000Z'
    }

    expect(getMetricTimestamp(metric)).toBe(
      new Date(metric.timestamp).getTime()
    )
  })

  test('sorts samples chronologically', () => {
    const points = buildMetricChartPoints([
      sample(10, 20),
      sample(0, 10),
      sample(5, 15)
    ], '1m')

    expect(points.map((point) => point.metric === null ? null : point.metric.cpu_usage))
      .toEqual([10, 15, 20])
  })

  test('inserts null points for missing raw sample intervals', () => {
    const points = buildMetricChartPoints([
      sample(0, 10),
      sample(5, 20),
      sample(15, 40),
      sample(20, 50)
    ], '1m')

    expect(points.map((point) => point.metric === null ? null : point.metric.cpu_usage))
      .toEqual([10, 20, null, 40, 50])

    expect(points[2].timestamp).toBe(10 * 1000)
  })

  test('uses five-minute intervals for rollup ranges', () => {
    const start = Date.parse('2026-11-02T10:00:00.000Z')

    const points = buildMetricChartPoints([
      { timestamp: new Date(start).toISOString(), cpu_usage: 10 },
      { timestamp: new Date(start + 10 * 60 * 1000).toISOString(), cpu_usage: 30 }
    ], '6h')

    expect(points.map((point) => point.metric === null ? null : point.metric.cpu_usage))
      .toEqual([10, null, 30])
  })

  test('uses hourly intervals for long rollup ranges', () => {
    const start = Date.parse('2026-11-02T10:00:00.000Z')

    const points = buildMetricChartPoints([
      { timestamp: new Date(start).toISOString(), cpu_usage: 10 },
      { timestamp: new Date(start + 2 * 60 * 60 * 1000).toISOString(), cpu_usage: 30 }
    ], '3d')

    expect(points.map((point) => point.metric === null ? null : point.metric.cpu_usage))
      .toEqual([10, null, 30])
  })

  test('does not insert gaps when samples are consecutive', () => {
    const points = buildMetricChartPoints([
      sample(0, 10),
      sample(5, 20),
      sample(10, 30)
    ], '1m')

    expect(points).toHaveLength(3)
    expect(points.every((point) => point.metric !== null)).toBe(true)
  })
})