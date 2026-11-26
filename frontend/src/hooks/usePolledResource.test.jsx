import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import usePolledResource from './usePolledResource'

function deferred() {
  let resolve
  let reject

  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('usePolledResource', () => {
  test('starts loading, then returns the fetched data', async () => {
    const fetcher = vi.fn().mockResolvedValue('A')

    const { result } = renderHook(() =>
      usePolledResource(fetcher, { key: 'a', intervalMs: 60000 })
    )

    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()

    await waitFor(() => expect(result.current.data).toBe('A'))

    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe('')
  })

  test('does not fetch while disabled', () => {
    const fetcher = vi.fn().mockResolvedValue('A')

    const { result } = renderHook(() =>
      usePolledResource(fetcher, { key: 'a', enabled: false })
    )

    expect(fetcher).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
  })

  test('drops the previous key\'s data as soon as the key changes', async () => {
    const pending = { b: deferred() }
    const fetcher = vi.fn()
      .mockResolvedValueOnce('A')
      .mockImplementationOnce(() => pending.b.promise)

    const { result, rerender } = renderHook(
      ({ k }) => usePolledResource(fetcher, { key: k, intervalMs: 60000 }),
      { initialProps: { k: 'a' } }
    )

    await waitFor(() => expect(result.current.data).toBe('A'))

    rerender({ k: 'b' })

    // Host A's data must not be shown while host B is loading.
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(true)

    await act(async () => {
      pending.b.resolve('B')
    })

    await waitFor(() => expect(result.current.data).toBe('B'))
  })

  test('ignores a late response for a key that is no longer shown', async () => {
    const first = deferred()
    const second = deferred()
    const signals = []

    const fetcher = vi.fn((signal) => {
      signals.push(signal)
      return signals.length === 1 ? first.promise : second.promise
    })

    const { result, rerender } = renderHook(
      ({ k }) => usePolledResource(fetcher, { key: k, intervalMs: 60000 }),
      { initialProps: { k: 'a' } }
    )

    rerender({ k: 'b' })

    expect(signals[0].aborted).toBe(true)

    await act(async () => {
      second.resolve('B')
    })

    await waitFor(() => expect(result.current.data).toBe('B'))

    await act(async () => {
      first.resolve('A')
    })

    expect(result.current.data).toBe('B')
  })

  test('reports a first-load failure and recovers on refetch', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('A')

    const { result } = renderHook(() =>
      usePolledResource(fetcher, { key: 'a', intervalMs: 60000 })
    )

    await waitFor(() => expect(result.current.error).toBe('boom'))

    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(false)

    act(() => result.current.refetch())

    await waitFor(() => expect(result.current.data).toBe('A'))

    expect(result.current.error).toBe('')
  })

  test('keeps the last good data when a refresh fails', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce('A')
      .mockRejectedValueOnce({ response: { data: { error: 'Server down' } } })

    const { result } = renderHook(() =>
      usePolledResource(fetcher, { key: 'a', intervalMs: 60000 })
    )

    await waitFor(() => expect(result.current.data).toBe('A'))

    act(() => result.current.refetch())

    await waitFor(() => expect(result.current.error).toBe('Server down'))

    expect(result.current.data).toBe('A')
    expect(result.current.updatedAt).toEqual(expect.any(Number))
  })
})
