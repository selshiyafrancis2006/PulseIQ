import { describe, expect, test } from 'vitest'
import { mergeLiveMetricSample } from './metricLiveUpdates'

const FROM = Date.parse('2026-11-20T04:00:00.000Z')
const TO = Date.parse('2026-11-20T04:02:00.000Z')

const createSample = (overrides = {}) => ({
  host_id: 1,
  collected_at: '2026-11-20T04:00:10.000Z',
  cpu_usage: 40,
  memory_usage: 50,
  disk_usage: 60,
  network_in: 100,
  network_out: 200,
  ...overrides
})

const createBucket = (overrides = {}) => ({
  host_id: 1,
  timestamp: '2026-11-20T04:00:00.000Z',
  latest_sample_timestamp: '2026-11-20T04:00:05.000Z',
  sample_count: 2,
  cpu_usage: 20,
  memory_usage: 30,
  disk_usage: 40,
  network_in: 80,
  network_out: 120,
  ...overrides
})

const options = {
  step: '1m',
  aggregation: 'avg',
  from: FROM,
  to: TO
}

describe('mergeLiveMetricSample', () => {
  test('creates a new bucket for a valid incoming sample', () => {
    const result = mergeLiveMetricSample(
      [],
      createSample(),
      options
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      host_id: 1,
      timestamp: '2026-11-20T04:00:00.000Z',
      latest_sample_timestamp: '2026-11-20T04:00:10.000Z',
      sample_count: 1,
      cpu_usage: 40,
      memory_usage: 50,
      disk_usage: 60,
      network_in: 100,
      network_out: 200
    })
  })

  test('updates an average using the existing sample count', () => {
    const result = mergeLiveMetricSample(
      [createBucket()],
      createSample(),
      options
    )

    expect(result[0].cpu_usage).toBeCloseTo(26.6666667)
    expect(result[0].memory_usage).toBeCloseTo(36.6666667)
    expect(result[0].disk_usage).toBeCloseTo(46.6666667)
    expect(result[0].network_in).toBeCloseTo(86.6666667)
    expect(result[0].network_out).toBeCloseTo(146.6666667)
    expect(result[0].sample_count).toBe(3)
    expect(result[0].latest_sample_timestamp)
      .toBe('2026-11-20T04:00:10.000Z')
  })

  test('updates minimum aggregation correctly', () => {
    const result = mergeLiveMetricSample(
      [createBucket()],
      createSample(),
      { ...options, aggregation: 'min' }
    )

    expect(result[0].cpu_usage).toBe(20)
    expect(result[0].network_in).toBe(80)
    expect(result[0].sample_count).toBe(3)
  })

  test('updates maximum aggregation correctly', () => {
    const result = mergeLiveMetricSample(
      [createBucket()],
      createSample(),
      { ...options, aggregation: 'max' }
    )

    expect(result[0].cpu_usage).toBe(40)
    expect(result[0].network_in).toBe(100)
    expect(result[0].sample_count).toBe(3)
  })

  test('uses the correct five-minute bucket boundary', () => {
    const sample = createSample({
      collected_at: '2026-11-20T04:04:59.000Z'
    })

    const result = mergeLiveMetricSample(
      [],
      sample,
      { ...options, step: '5m', to: Date.parse('2026-11-20T04:05:00.000Z') }
    )

    expect(result[0].timestamp)
      .toBe('2026-11-20T04:00:00.000Z')
  })

  test('ignores duplicate and older samples', () => {
    const bucket = createBucket()
    const duplicate = createSample({
      collected_at: '2026-11-20T04:00:05.000Z'
    })
    const older = createSample({
      collected_at: '2026-11-20T04:00:03.000Z'
    })

    const rows = [bucket]

    expect(mergeLiveMetricSample(
      rows,
      duplicate,
      options
    )).toBe(rows)

    expect(mergeLiveMetricSample(
      rows,
      older,
      options
    )).toBe(rows)

    expect(bucket.sample_count).toBe(2)
    expect(bucket.cpu_usage).toBe(20)
  })

  test('rejects invalid metric values and samples outside the query range', () => {
    const invalidSamples = [
      createSample({ cpu_usage: null }),
      createSample({ cpu_usage: 101 }),
      createSample({ memory_usage: -1 }),
      createSample({ network_in: NaN }),
      createSample({ collected_at: 'invalid-date' }),
      createSample({ collected_at: '2026-11-20T04:02:00.000Z' })
    ]

    for (const sample of invalidSamples) {
      const rows = []
      expect(mergeLiveMetricSample(rows, sample, options)).toBe(rows)
    }
  })

  test('does not update an existing bucket without valid metadata', () => {
    const bucket = createBucket({ sample_count: undefined })
    const rows = [bucket]

    expect(mergeLiveMetricSample(
      rows,
      createSample(),
      options
    )).toBe(rows)
  })

  test('does not mutate the original rows or bucket', () => {
    const bucket = createBucket()
    const rows = [bucket]

    const result = mergeLiveMetricSample(
      rows,
      createSample(),
      options
    )

    expect(result).not.toBe(rows)
    expect(result[0]).not.toBe(bucket)
    expect(bucket.cpu_usage).toBe(20)
    expect(bucket.sample_count).toBe(2)
  })
})