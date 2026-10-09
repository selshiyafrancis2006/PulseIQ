export const ONLINE_THRESHOLD_MS = 30000

export function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_THRESHOLD_MS
}

export function timeAgo(dateString) {
  if (!dateString) return 'Never'

  const diffSec = Math.max(
    0,
    Math.floor((Date.now() - new Date(dateString).getTime()) / 1000)
  )

  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}

export function formatUptime(bootTime) {
  if (!bootTime) return '—'

  const sec = Math.floor((Date.now() - new Date(bootTime).getTime()) / 1000)
  if (!Number.isFinite(sec) || sec < 0) return '—'

  const days = Math.floor(sec / 86400)
  const hours = Math.floor((sec % 86400) / 3600)
  const minutes = Math.floor((sec % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function formatMemory(mb) {
  if (mb == null) return '—'
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
}

export function formatRate(kbps) {
  if (kbps == null) return '—'
  const n = Number(kbps)
  return n >= 1024 ? `${(n / 1024).toFixed(1)} MB/s` : `${n.toFixed(1)} KB/s`
}