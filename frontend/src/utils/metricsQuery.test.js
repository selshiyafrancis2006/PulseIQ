import { describe, expect, test } from 'vitest'
import {
  alignTimestamp,
  getQuerySourceResolution,
  getCompatibleQuerySteps,
  isP95Available,
  getPresetRangeBounds,
  getAlignedQueryRange,
  getAlignedCustomQueryRange
} from './metricsQuery'

const MINUTE = 60 * 1000
const FIVE_MINUTES = 5 * MINUTE
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const NOW = Date.parse('2026-11-17T12:00:00.000Z')

describe('metricsQuery', () => {
  test('aligns timestamps down to the requested boundary', () => {
    expect(alignTimestamp(127 * MINUTE, FIVE_MINUTES))
      .toBe(125 * MINUTE)
  })

  test('detects raw resolution for a range within three days', () => {
    const result = getQuerySourceResolution(
      NOW - DAY,
      NOW - HOUR,
      NOW
    )

    expect(result).toEqual({
      resolutionMs: MINUTE,
      usesRollup: false
    })
  })

  test('detects five-minute resolution for a range between three and eight days', () => {
    const result = getQuerySourceResolution(
      NOW - 5 * DAY,
      NOW - 4 * DAY,
      NOW
    )

    expect(result).toEqual({
      resolutionMs: FIVE_MINUTES,
      usesRollup: true
    })
  })

  test('detects hourly resolution for a range older than eight days', () => {
    const result = getQuerySourceResolution(
      NOW - 20 * DAY,
      NOW - 19 * DAY,
      NOW
    )

    expect(result).toEqual({
      resolutionMs: HOUR,
      usesRollup: true
    })
  })

  test('uses the coarsest resolution for a range crossing source cutovers', () => {
    const result = getQuerySourceResolution(
      NOW - 10 * DAY,
      NOW - DAY,
      NOW
    )

    expect(result).toEqual({
      resolutionMs: HOUR,
      usesRollup: true
    })
  })

  test('allows P95 only when the entire range uses raw data', () => {
    expect(isP95Available(
      NOW - DAY,
      NOW - HOUR,
      NOW
    )).toBe(true)

    expect(isP95Available(
      NOW - 5 * DAY,
      NOW - 4 * DAY,
      NOW
    )).toBe(false)

    expect(isP95Available(
      NOW - 10 * DAY,
      NOW - DAY,
      NOW
    )).toBe(false)
  })

  test('returns only steps compatible with the source resolution', () => {
    expect(getCompatibleQuerySteps(MINUTE))
      .toEqual(['1m', '5m', '15m', '1h', '6h', '1d'])

    expect(getCompatibleQuerySteps(FIVE_MINUTES))
      .toEqual(['5m', '15m', '1h', '6h', '1d'])

    expect(getCompatibleQuerySteps(HOUR))
      .toEqual(['1h', '6h', '1d'])
  })
})

describe('metricsQuery cutover boundaries', () => {
  const NOW = Date.parse('2026-11-17T12:00:00.000Z')
  const MINUTE = 60 * 1000
  const FIVE_MINUTES = 5 * MINUTE
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR

  const rawCutover = Math.ceil(
    (NOW - 3 * DAY) / FIVE_MINUTES
  ) * FIVE_MINUTES

  const rollup5mCutover = Math.ceil(
    (NOW - 8 * DAY) / HOUR
  ) * HOUR

  test('starts raw data at the exact raw cutover', () => {
    expect(getQuerySourceResolution(
      rawCutover,
      rawCutover + FIVE_MINUTES,
      NOW
    )).toEqual({
      resolutionMs: MINUTE,
      usesRollup: false
    })
  })

  test('keeps the bucket ending at the raw cutover in five-minute rollups', () => {
    expect(getQuerySourceResolution(
      rawCutover - FIVE_MINUTES,
      rawCutover,
      NOW
    )).toEqual({
      resolutionMs: FIVE_MINUTES,
      usesRollup: true
    })
  })

  test('starts five-minute rollups at the exact eight-day cutover', () => {
    expect(getQuerySourceResolution(
      rollup5mCutover,
      rollup5mCutover + HOUR,
      NOW
    )).toEqual({
      resolutionMs: FIVE_MINUTES,
      usesRollup: true
    })
  })

  test('keeps the bucket ending at the eight-day cutover in hourly rollups', () => {
    expect(getQuerySourceResolution(
      rollup5mCutover - HOUR,
      rollup5mCutover,
      NOW
    )).toEqual({
      resolutionMs: HOUR,
      usesRollup: true
    })
  })
})

describe('metricsQuery preset ranges', () => {
  test('calculates the selected preset range from a supplied timestamp', () => {
    const now = Date.parse('2026-11-17T12:00:00.000Z')

    expect(getPresetRangeBounds('24h', now)).toEqual({
      from: now - 24 * 60 * 60 * 1000,
      to: now
    })
  })

  test('returns null for an unsupported preset', () => {
    expect(getPresetRangeBounds('custom', 1000)).toBeNull()
  })

  test('calculates the six-hour preset correctly', () => {
    const now = Date.parse('2026-11-17T12:00:00.000Z')

    expect(getPresetRangeBounds('6h', now)).toEqual({
      from: now - 6 * HOUR,
      to: now
    })
  })
})

describe('metricsQuery aligned ranges', () => {
  const NOW = Date.parse('2026-11-17T12:00:00.000Z')

  test('keeps a one-minute preset aligned to raw-data boundaries', () => {
    expect(getAlignedQueryRange('1m', NOW)).toEqual({
      from: NOW - MINUTE,
      to: NOW,
      resolutionMs: MINUTE,
      usesRollup: false
    })
  })

  test('aligns a seven-day range to five-minute boundaries', () => {
    expect(getAlignedQueryRange('7d', NOW)).toEqual({
      from: NOW - 7 * DAY,
      to: NOW,
      resolutionMs: FIVE_MINUTES,
      usesRollup: true
    })
  })

  test('aligns a thirty-day range to hourly boundaries', () => {
    expect(getAlignedQueryRange('30d', NOW)).toEqual({
      from: NOW - 30 * DAY,
      to: NOW,
      resolutionMs: HOUR,
      usesRollup: true
    })
  })

  test('uses the latest complete minute when the current time is unaligned', () => {
    const unalignedNow = NOW + 30 * 1000

    expect(getAlignedQueryRange('1m', unalignedNow)).toEqual({
      from: NOW - MINUTE,
      to: NOW,
      resolutionMs: MINUTE,
      usesRollup: false
    })
  })

  test('returns null for an unsupported range', () => {
    expect(getAlignedQueryRange('custom', NOW)).toBeNull()
  })
describe('metricsQuery custom ranges', () => {
  const NOW = Date.parse('2026-11-17T12:00:00.000Z')

  test('aligns a custom raw-data range to minute boundaries', () => {
    const from = Date.parse('2026-11-17T11:00:30.000Z')
    const to = Date.parse('2026-11-17T11:30:45.000Z')

    expect(getAlignedCustomQueryRange(from, to, NOW)).toEqual({
      from: Date.parse('2026-11-17T11:00:00.000Z'),
      to: Date.parse('2026-11-17T11:30:00.000Z'),
      resolutionMs: MINUTE,
      usesRollup: false
    })
  })

  test('aligns a custom range containing five-minute rollups', () => {
    const from = NOW - 5 * DAY
    const to = NOW - 4 * DAY

    expect(getAlignedCustomQueryRange(from, to, NOW)).toEqual({
      from: Math.ceil(from / FIVE_MINUTES) * FIVE_MINUTES,
      to: Math.floor(to / FIVE_MINUTES) * FIVE_MINUTES,
      resolutionMs: FIVE_MINUTES,
      usesRollup: true
    })
  })

  test('aligns a custom range containing hourly rollups', () => {
    const from = NOW - 30 * DAY
    const to = NOW - 29 * DAY

    expect(getAlignedCustomQueryRange(from, to, NOW)).toEqual({
      from: Math.ceil(from / HOUR) * HOUR,
      to: Math.floor(to / HOUR) * HOUR,
      resolutionMs: HOUR,
      usesRollup: true
    })
  })

  test('returns null when the custom range is invalid', () => {
    expect(getAlignedCustomQueryRange(NOW, NOW, NOW)).toBeNull()
    expect(getAlignedCustomQueryRange(NOW, NOW - MINUTE, NOW)).toBeNull()
    expect(getAlignedCustomQueryRange(NOW - MINUTE, NOW + MINUTE, NOW)).toBeNull()
    expect(getAlignedCustomQueryRange(NOW - 91 * DAY, NOW, NOW)).toBeNull()
  })
})
})



