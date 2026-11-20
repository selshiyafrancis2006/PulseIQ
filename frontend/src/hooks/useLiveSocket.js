import { useEffect, useRef, useState } from 'react'

// The backend closes with these codes when retrying cannot help:
// 4401 invalid/expired token, 4400 missing/invalid host_id, 4403 host not owned.
const NO_RETRY_CLOSE_CODES = new Set([4400, 4401, 4403])

export const getReconnectDelayMs = (
  attempt,
  baseMs = 1000,
  maxMs = 30000
) => Math.min(maxMs, baseMs * 2 ** attempt)

// Keeps a WebSocket open to `url` and reconnects with exponential backoff.
//
// Returns the connection status:
//   'off'          no url (live updates not wanted)
//   'paused'       `paused` is true (hidden tab); the socket is closed
//   'connecting'   first connection attempt in progress
//   'live'         connected
//   'reconnecting' dropped, waiting to retry
//   'unavailable'  server refused for good (bad token / host); not retried
//
// `onMessage` may change on every render; the latest one is always used and
// changing it never reconnects the socket.
export default function useLiveSocket({ url, paused = false, onMessage }) {
  const [state, setState] = useState({ url: null, status: 'connecting' })
  const onMessageRef = useRef(onMessage)

  useEffect(() => {
    onMessageRef.current = onMessage
  })

  useEffect(() => {
    if (!url || paused) return

    let socket = null
    let timer = null
    let attempt = 0
    let stopped = false

    const setStatus = (status) => setState({ url, status })

    const scheduleReconnect = () => {
      setStatus('reconnecting')
      timer = setTimeout(() => {
        timer = null
        connect()
      }, getReconnectDelayMs(attempt))
      attempt += 1
    }

    function connect() {
      let current

      try {
        current = new WebSocket(url)
      } catch (err) {
        console.error('Metrics WebSocket connection failed', err)
        setStatus('unavailable')
        return
      }

      socket = current

      current.onopen = () => {
        attempt = 0
        setStatus('live')
      }

      current.onmessage = (event) => {
        onMessageRef.current?.(event)
      }

      current.onclose = (event) => {
        socket = null

        if (stopped) return

        if (NO_RETRY_CLOSE_CODES.has(event?.code)) {
          setStatus('unavailable')
          return
        }

        scheduleReconnect()
      }
    }

    connect()

    return () => {
      stopped = true
      clearTimeout(timer)

      if (socket) {
        socket.onopen = null
        socket.onmessage = null
        socket.onclose = null
        socket.close()
      }
    }
  }, [url, paused])

  if (!url) return 'off'
  if (paused) return 'paused'

  return state.url === url ? state.status : 'connecting'
}