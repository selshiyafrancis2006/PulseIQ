const MINUTE_MS = 60 * 1000
const FIVE_MINUTES_MS = 5 * MINUTE_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

const QUERY_STEPS = {
  '1m': MINUTE_MS,
  '5m': FIVE_MINUTES_MS,
  '15m': 15 * MINUTE_MS,
  '1h': HOUR_MS,
  '6h': 6 * HOUR_MS,
  '1d': DAY_MS
}

export const alignTimestamp = (timestamp, resolutionMs) => {
  return Math.floor(timestamp / resolutionMs) * resolutionMs
}

export const getQuerySourceResolution = (
  from,
  to,
  now = Date.now(),
  rawRetentionDays = 3,
  rollup5mRetentionDays = 8
) => {
  const rawCutover = Math.ceil(
    (now - rawRetentionDays * DAY_MS) / FIVE_MINUTES_MS
  ) * FIVE_MINUTES_MS

  const rollup5mCutover = Math.ceil(
    (now - rollup5mRetentionDays * DAY_MS) / HOUR_MS
  ) * HOUR_MS

  let resolutionMs = 0
  let usesRollup = false

  if (from < Math.min(to, rollup5mCutover)) {
    resolutionMs = HOUR_MS
    usesRollup = true
  }

  if (
    Math.max(from, rollup5mCutover) <
    Math.min(to, rawCutover)
  ) {
    resolutionMs = Math.max(resolutionMs, FIVE_MINUTES_MS)
    usesRollup = true
  }

  if (Math.max(from, rawCutover) < to) {
    resolutionMs = Math.max(resolutionMs, MINUTE_MS)
  }

  return {
    resolutionMs,
    usesRollup
  }
}

export const getCompatibleQuerySteps = (resolutionMs) => {
  return Object.entries(QUERY_STEPS)
    .filter(([, duration]) => duration >= resolutionMs)
    .map(([step]) => step)
}

export const isP95Available = (from, to, now = Date.now()) => {
  return !getQuerySourceResolution(from, to, now).usesRollup
}

const PRESET_RANGE_MS = {
  '1m': MINUTE_MS,
  '5m': 5 * MINUTE_MS,
  '15m': 15 * MINUTE_MS,
  '1h': HOUR_MS,
  '6h': 6 * HOUR_MS,
  '24h': DAY_MS,
  '3d': 3 * DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
  '90d': 90 * DAY_MS
}

export const getPresetRangeBounds = (timeRange, now = Date.now()) => {
  const duration = PRESET_RANGE_MS[timeRange]

  if (!duration) return null

  return {
    from: now - duration,
    to: now
  }
}

export const getAlignedQueryRange = (
  timeRange,
  now = Date.now(),
  rawRetentionDays = 3,
  rollup5mRetentionDays = 8
) => {
  const bounds = getPresetRangeBounds(timeRange, now)

  if (!bounds) return null

  const initialSource = getQuerySourceResolution(
    bounds.from,
    bounds.to,
    now,
    rawRetentionDays,
    rollup5mRetentionDays
  )

  const resolutionMs = initialSource.resolutionMs || MINUTE_MS

  const to = Math.floor(bounds.to / resolutionMs) * resolutionMs
  let from = Math.ceil(bounds.from / resolutionMs) * resolutionMs

  if (from >= to) {
    const duration = PRESET_RANGE_MS[timeRange]

    if (duration !== resolutionMs) return null

    from = to - resolutionMs
  }

  const finalSource = getQuerySourceResolution(
    from,
    to,
    now,
    rawRetentionDays,
    rollup5mRetentionDays
  )

  return {
    from,
    to,
    resolutionMs: finalSource.resolutionMs || resolutionMs,
    usesRollup: finalSource.usesRollup
  }
}


export const getAlignedCustomQueryRange = (
  from,
  to,
  now = Date.now(),
  rawRetentionDays = 3,
  rollup5mRetentionDays = 8
) => {
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from >= to ||
    to > now ||
    from < now - 90 * DAY_MS
  ) {
    return null
  }

  let source = getQuerySourceResolution(
    from,
    to,
    now,
    rawRetentionDays,
    rollup5mRetentionDays
  )

  let resolutionMs = source.resolutionMs || MINUTE_MS

  let alignedFrom = Math.floor(from / resolutionMs) * resolutionMs
  let alignedTo = Math.floor(to / resolutionMs) * resolutionMs

  if (alignedFrom >= alignedTo) {
    return null
  }

  const finalSource = getQuerySourceResolution(
    alignedFrom,
    alignedTo,
    now,
    rawRetentionDays,
    rollup5mRetentionDays
  )

  if (finalSource.resolutionMs > resolutionMs) {
    resolutionMs = finalSource.resolutionMs

    alignedFrom = Math.floor(from / resolutionMs) * resolutionMs
    alignedTo = Math.floor(to / resolutionMs) * resolutionMs
  }

  if (alignedFrom >= alignedTo) {
    return null
  }

  const verifiedSource = getQuerySourceResolution(
    alignedFrom,
    alignedTo,
    now,
    rawRetentionDays,
    rollup5mRetentionDays
  )

  return {
    from: alignedFrom,
    to: alignedTo,
    resolutionMs: verifiedSource.resolutionMs || resolutionMs,
    usesRollup: verifiedSource.usesRollup
  }
}

