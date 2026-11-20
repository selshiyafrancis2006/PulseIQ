const STEP_MS = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000
}

const METRIC_FIELDS = [
  'cpu_usage',
  'memory_usage',
  'disk_usage',
  'network_in',
  'network_out'
]

const DATE_BIN_ORIGIN = Date.UTC(2000, 0, 1)

export const mergeLiveMetricSample = (
  rows,
  sample,
  { step, aggregation, from, to }
) => {
  const stepMs = STEP_MS[step]
  const sampleTimestamp = new Date(
    sample?.collected_at || sample?.timestamp
  ).getTime()

  if (
    !Array.isArray(rows) ||
    !stepMs ||
    !['avg', 'min', 'max'].includes(aggregation) ||
    !sample ||
    typeof sample !== 'object' ||
    !Number.isFinite(sampleTimestamp) ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from >= to ||
    sampleTimestamp < from ||
    sampleTimestamp >= to ||
    (typeof sample.host_id !== 'number' && typeof sample.host_id !== 'string') ||
    String(sample.host_id).trim() === '' ||
    !Number.isFinite(Number(sample.host_id)) ||
    !METRIC_FIELDS.every(field =>
      typeof sample[field] === 'number' &&
      Number.isFinite(sample[field]) &&
      sample[field] >= 0 &&
      (!['cpu_usage', 'memory_usage', 'disk_usage'].includes(field) ||
        sample[field] <= 100)
    )
  ) {
    return rows
  }

  const bucketTimestamp =
    Math.floor(
      (sampleTimestamp - DATE_BIN_ORIGIN) / stepMs
    ) * stepMs + DATE_BIN_ORIGIN

  const bucket = rows.find(row =>
    String(row.host_id) === String(sample.host_id) &&
    new Date(row.timestamp).getTime() === bucketTimestamp
  )

  if (!bucket) {
    return [
      ...rows,
      {
        host_id: sample.host_id,
        timestamp: new Date(bucketTimestamp).toISOString(),
        latest_sample_timestamp: new Date(sampleTimestamp).toISOString(),
        sample_count: 1,
        ...Object.fromEntries(
          METRIC_FIELDS.map(field => [field, Number(sample[field])])
        )
      }
    ].sort((a, b) =>
      String(a.host_id).localeCompare(String(b.host_id)) ||
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
  }

  const latestTimestamp = new Date(
    bucket.latest_sample_timestamp
  ).getTime()
  const sampleCount = Number(bucket.sample_count)

  // Without valid metadata, or for an old/duplicate sample,
  // leave reconciliation to the next API poll.
  if (
    !Number.isFinite(latestTimestamp) ||
    !Number.isInteger(sampleCount) ||
    sampleCount < 1 ||
    sampleTimestamp <= latestTimestamp ||
    !METRIC_FIELDS.every(field =>
      typeof bucket[field] === 'number' &&
      Number.isFinite(bucket[field])
    )
  ) {
    return rows
  }

  const updatedBucket = {
    ...bucket,
    sample_count: sampleCount + 1,
    latest_sample_timestamp: new Date(sampleTimestamp).toISOString()
  }

  for (const field of METRIC_FIELDS) {
    const currentValue = Number(bucket[field])
    const incomingValue = Number(sample[field])

    if (!Number.isFinite(currentValue)) continue

    if (aggregation === 'avg') {
      updatedBucket[field] = (
        currentValue * sampleCount + incomingValue
      ) / (sampleCount + 1)
    } else if (aggregation === 'min') {
      updatedBucket[field] = Math.min(currentValue, incomingValue)
    } else {
      updatedBucket[field] = Math.max(currentValue, incomingValue)
    }
  }

  return rows.map(row => row === bucket ? updatedBucket : row)
}