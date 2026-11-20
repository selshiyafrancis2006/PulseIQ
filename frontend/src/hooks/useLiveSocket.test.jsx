import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import useLiveSocket, { getReconnectDelayMs } from './useLiveSocket'

class MockWebSocket {
  static instances = []

  constructor(url) {
    this.url = url
    this.onopen = null
    this.onmessage = null
    this.onclose = null
    this.close = vi.fn()
    MockWebSocket.instances.push(this)
  }

  open() {
    this.onopen?.()
  }

  drop(code = 1006) {
    this.onclose?.({ code })
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('getReconnectDelayMs', () => {
  test('doubles each attempt and stops at the maximum', () => {
    expect([0, 1, 2, 3].map(n => getReconnectDelayMs(n))).toEqual([
      1000, 2000, 4000, 8000
    ])
    expect(getReconnectDelayMs(10)).toBe(30000)
  })
})

describe('useLiveSocket', () => {
  test('is off without a url and opens no socket', () => {
    const { result } = renderHook(() => useLiveSocket({ url: null }))

    expect(result.current).toBe('off')
    expect(MockWebSocket.instances).toHaveLength(0)
  })

  test('goes connecting -> live and forwards messages', () => {
    const onMessage = vi.fn()
    const { result } = renderHook(() =>
      useLiveSocket({ url: 'ws://x/?a=1', onMessage })
    )

    expect(result.current).toBe('connecting')

    act(() => MockWebSocket.instances[0].open())
    expect(result.current).toBe('live')

    act(() => MockWebSocket.instances[0].onmessage({ data: 'hello' }))
    expect(onMessage).toHaveBeenCalledWith({ data: 'hello' })
  })

  test('reconnects with growing backoff and resets after a successful open', () => {
    const { result } = renderHook(() => useLiveSocket({ url: 'ws://x/' }))

    act(() => MockWebSocket.instances[0].open())
    act(() => MockWebSocket.instances[0].drop())
    expect(result.current).toBe('reconnecting')

    act(() => vi.advanceTimersByTime(999))
    expect(MockWebSocket.instances).toHaveLength(1)
    act(() => vi.advanceTimersByTime(1))
    expect(MockWebSocket.instances).toHaveLength(2)

    // Second drop without opening: delay doubles to 2s.
    act(() => MockWebSocket.instances[1].drop())
    act(() => vi.advanceTimersByTime(1999))
    expect(MockWebSocket.instances).toHaveLength(2)
    act(() => vi.advanceTimersByTime(1))
    expect(MockWebSocket.instances).toHaveLength(3)

    // Opening resets the backoff to 1s.
    act(() => MockWebSocket.instances[2].open())
    expect(result.current).toBe('live')
    act(() => MockWebSocket.instances[2].drop())
    act(() => vi.advanceTimersByTime(1000))
    expect(MockWebSocket.instances).toHaveLength(4)
  })

  test.each([4400, 4401, 4403])(
    'does not retry after close code %i',
    (code) => {
      const { result } = renderHook(() => useLiveSocket({ url: 'ws://x/' }))

      act(() => MockWebSocket.instances[0].drop(code))
      act(() => vi.advanceTimersByTime(60000))

      expect(result.current).toBe('unavailable')
      expect(MockWebSocket.instances).toHaveLength(1)
    }
  )

  test('closes the socket while paused and reconnects when resumed', () => {
    const { result, rerender } = renderHook(
      ({ paused }) => useLiveSocket({ url: 'ws://x/', paused }),
      { initialProps: { paused: false } }
    )

    act(() => MockWebSocket.instances[0].open())
    const first = MockWebSocket.instances[0]

    rerender({ paused: true })
    expect(result.current).toBe('paused')
    expect(first.close).toHaveBeenCalledOnce()

    rerender({ paused: false })
    expect(MockWebSocket.instances).toHaveLength(2)
  })

  test('cancels a pending reconnect on unmount', () => {
    const { unmount } = renderHook(() => useLiveSocket({ url: 'ws://x/' }))

    act(() => MockWebSocket.instances[0].drop())
    unmount()
    act(() => vi.advanceTimersByTime(60000))

    expect(MockWebSocket.instances).toHaveLength(1)
  })
})