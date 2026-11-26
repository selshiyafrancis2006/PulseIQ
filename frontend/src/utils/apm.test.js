import { describe, expect, test } from 'vitest'
import {
  APM_RANGES,
  DEFAULT_APM_RANGE,
  formatMs,
  formatPercent,
  formatThroughput,
  getApmRange,
  toChartNumber
} from './apm'

describe('apm utils', () => {
  test('offers exactly the ranges the API accepts', () => {
    expect(APM_RANGES.map((range) => range.value)).toEqual(['15m', '1h', '6h', '24h', '7d'])
    expect(DEFAULT_APM_RANGE).toBe('1h')
  })

  test('falls back to the default range for an unknown value', () => {
    expect(getApmRange('2h').value).toBe('1h')
    expect(getApmRange('7d').value).toBe('7d')
  })

  test('shows a dash, not zero, when there is no value', () => {
    expect(formatMs(null)).toBe('â€”')
    expect(formatMs(undefined)).toBe('â€”')
    expect(formatPercent(null)).toBe('â€”')
    expect(formatThroughput(null)).toBe('â€”')
  })

  test('formats real values, including zero', () => {
    expect(formatMs(95.5)).toBe('95.5 ms')
    expect(formatMs(0)).toBe('0 ms')
    expect(formatPercent(3.96)).toBe('3.96%')
    expect(formatPercent(0)).toBe('0%')
    expect(formatThroughput(6.8)).toBe('6.8 req/min')
  })

  test('chart values keep missing data as null so lines show a gap', () => {
    expect(toChartNumber(null)).toBeNull()
    expect(toChartNumber(undefined)).toBeNull()
    expect(toChartNumber(0)).toBe(0)
    expect(toChartNumber('12.5')).toBe(12.5)
  })
})