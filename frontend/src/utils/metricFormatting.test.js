import { describe, expect, test } from 'vitest'
import {
  getMetricUnit,
  formatMetricValue
} from './metricFormatting'

describe('getMetricUnit', () => {
  test.each([
    ['cpu_usage', '%'],
    ['memory_usage', '%'],
    ['disk_usage', '%'],
    ['network_in', 'KB/s'],
    ['network_out', 'KB/s']
  ])('returns the configured unit for %s', (metric, expected) => {
    expect(getMetricUnit(metric)).toBe(expected)
  })

  test('returns an empty string for an unknown metric', () => {
    expect(getMetricUnit('unknown_metric')).toBe('')
  })
})

describe('formatMetricValue', () => {
  test('formats percentage metrics with their unit', () => {
    expect(formatMetricValue('cpu_usage', 45)).toBe('45.00%')
    expect(formatMetricValue('memory_usage', 72.5)).toBe('72.50%')
  })

  test('formats network values using the existing KB/s formatter', () => {
    expect(formatMetricValue('network_in', 12)).toBe('12.0 KB/s')
    expect(formatMetricValue('network_out', 1024)).toBe('1.0 MB/s')
  })

  test.each([null, undefined, ''])(
    'returns an em dash for missing values (%s)',
    value => {
      expect(formatMetricValue('cpu_usage', value)).toBe('—')
    }
  )

  test('returns an em dash for non-numeric values', () => {
    expect(formatMetricValue('network_in', 'invalid')).toBe('—')
  })
})

describe('formatMetricColumnHeader', () => {
  test('adds the configured unit to metric columns', async () => {
    const { formatMetricColumnHeader } = await import('./metricFormatting')

    expect(formatMetricColumnHeader('cpu_usage')).toBe('cpu_usage (%)')
    expect(formatMetricColumnHeader('network_in')).toBe('network_in (KB/s)')
  })

  test('preserves rollup suffixes and adds the metric unit', async () => {
    const { formatMetricColumnHeader } = await import('./metricFormatting')

    expect(formatMetricColumnHeader('cpu_usage_min')).toBe('cpu_usage_min (%)')
    expect(formatMetricColumnHeader('network_out_max')).toBe('network_out_max (KB/s)')
  })

  test('leaves non-metric columns unchanged', async () => {
    const { formatMetricColumnHeader } = await import('./metricFormatting')

    expect(formatMetricColumnHeader('timestamp')).toBe('timestamp')
    expect(formatMetricColumnHeader('sample_count')).toBe('sample_count')
  })
})

