import { useCallback, useEffect, useRef, useState } from 'react'
import usePageVisible from './usePageVisible'

const EMPTY = { key: null, data: null, error: '', loaded: false, updatedAt: null }

function isAbort(err) {
  return (
    err?.name === 'AbortError' ||
    err?.name === 'CanceledError' ||
    err?.code === 'ERR_CANCELED'
  )
}

function errorMessage(err) {
  return err?.response?.data?.error || err?.message || 'Request failed'
}

// Polls `fetcher(signal)` and keeps the result in sync with `key`.
//
// - `key` identifies what is being shown (host, time range, ...). When it
//   changes, the previous key's data is never returned, so a different host's
//   numbers cannot flash on screen.
// - A response for an old key (or an unmounted component) is ignored, and the
//   in-flight request is aborted.
// - The next poll is scheduled only after the previous one finishes, so a slow
//   server never gets overlapping requests.
// - Polling pauses while the browser tab is hidden and fetches again as soon
//   as it is visible.
// - A failed refresh keeps the last good data and sets `error`; `loaded` and
//   `data` tell a first-load failure from a failed refresh.
export default function usePolledResource(
  fetcher,
  { key, enabled = true, intervalMs = 5000 }
) {
  const visible = usePageVisible()
  const [state, setState] = useState(EMPTY)
  const [nonce, setNonce] = useState(0)

  const fetcherRef = useRef(fetcher)

  useEffect(() => {
    fetcherRef.current = fetcher
  })

  useEffect(() => {
    if (!enabled || !visible) return undefined

    const controller = new AbortController()
    let active = true
    let timer = null

    const tick = async () => {
      try {
        const data = await fetcherRef.current(controller.signal)

        if (!active) return

        setState({ key, data, error: '', loaded: true, updatedAt: Date.now() })
      } catch (err) {
        if (!active || isAbort(err)) return

        console.error('Polled request failed:', err)

        setState((prev) => ({
          ...(prev.key === key ? prev : { ...EMPTY, key }),
          error: errorMessage(err)
        }))
      }

      if (active) {
        timer = setTimeout(tick, intervalMs)
      }
    }

    tick()

    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [key, enabled, visible, intervalMs, nonce])

  const refetch = useCallback(() => setNonce((n) => n + 1), [])

  const current = state.key === key ? state : EMPTY

  return {
    data: current.data,
    error: current.error,
    updatedAt: current.updatedAt,
    loading: enabled && !current.loaded && !current.error,
    refetch
  }
}
