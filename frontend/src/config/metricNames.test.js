import { describe, expect, test } from 'vitest'
import { BUILT_IN_METRICS, METRIC_NAMES, METRICS } from './metricNames'

describe('frontend metric registry', () => {
  test('name is the metric key and label is the display name', () => {
    expect(BUILT_IN_METRICS.map((metric) => metric.name)).toEqual(METRIC_NAMES)

    for (const metric of BUILT_IN_METRICS) {
      expect(metric.label).toBe(METRICS[metric.name].name)
    }
  })

  test('every metric key can index a host row field', () => {
    for (const metric of BUILT_IN_METRICS) {
      expect(metric.name).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })
})
