import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { apiFetch } from '../utils/apiFetch'
import Metrics from './Metrics'
class MockWebSocket {
  static instances = []

  constructor(url) {
    this.url = url
    this.onmessage = null
    this.close = vi.fn()
    MockWebSocket.instances.push(this)
  }

  receive(data) {
    this.onmessage?.({ data })
  }
}

vi.mock('../utils/apiFetch', () => ({
  apiFetch: vi.fn(),
}))

vi.mock('../hooks/useHosts', () => ({
  default: () => ({
    hosts: [],
    selectedHostId: 1,
    setSelectedHostId: vi.fn(),
  }),
}))

vi.mock('../components/shared/hostSelector', () => ({
  default: () => null,
}))

vi.mock('../components/metrics/MetricSelector', () => ({
  default: () => null,
}))

vi.mock('../components/metrics/StatsCards', () => ({
  default: () => null,
}))

vi.mock('../components/metrics/MetricsChart', () => ({
  default: () => null,
}))

vi.mock('../components/metrics/MetricsTable', () => ({
  default: ({ metrics }) => (
    <div data-testid="metrics-count">{metrics.length}</div>
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
  MockWebSocket.instances = []
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Metrics page WebSocket live updates', () => {
  test('connects for a short single-host range, merges samples without refetching, and closes on unmount', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-11-20T04:30:00.000Z').getTime())

    vi.stubGlobal('WebSocket', MockWebSocket)
    localStorage.setItem('token', 'test-jwt-token')

    apiFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [] }),
    })

    const { unmount } = render(<Metrics />)

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1)
      expect(apiFetch).toHaveBeenCalledTimes(1)
    })

    const socket = MockWebSocket.instances[0]

    expect(socket.url).toContain('token=test-jwt-token')
    expect(socket.url).toContain('host_id=1')

    socket.receive(JSON.stringify({
      host_id: 1,
      sample_id: '11111111-1111-4111-8111-111111111111',
      collected_at: '2026-11-20T04:29:30.000Z',
      cpu_usage: 20,
      memory_usage: 30,
      disk_usage: 40,
      network_in: 50,
      network_out: 60
    }))

    await waitFor(() => {
      expect(screen.getByTestId('metrics-count')).toHaveTextContent('1')
    })

    expect(apiFetch).toHaveBeenCalledTimes(1)

    unmount()

    expect(socket.close).toHaveBeenCalledOnce()
    localStorage.removeItem('token')
  })

  test('discards an API response started before a newer WebSocket sample', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-11-20T04:30:00.000Z').getTime()
    )

    vi.stubGlobal('WebSocket', MockWebSocket)
    localStorage.setItem('token', 'test-jwt-token')

    let resolveRequest

    apiFetch.mockReturnValue(new Promise(resolve => {
      resolveRequest = resolve
    }))

    const { unmount } = render(<Metrics />)

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1)
      expect(apiFetch).toHaveBeenCalledTimes(1)
    })

    const socket = MockWebSocket.instances[0]

    socket.receive(JSON.stringify({
      host_id: 1,
      sample_id: '22222222-2222-4222-8222-222222222222',
      collected_at: '2026-11-20T04:29:30.000Z',
      cpu_usage: 20,
      memory_usage: 30,
      disk_usage: 40,
      network_in: 50,
      network_out: 60
    }))

    await act(async () => {
      resolveRequest({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{
            host_id: 1,
            timestamp: '2026-11-20T04:29:00.000Z',
            latest_sample_timestamp: '2026-11-20T04:29:00.000Z',
            sample_count: 1,
            cpu_usage: 10,
            memory_usage: 20,
            disk_usage: 30,
            network_in: 40,
            network_out: 50
          }]
        })
      })
    })

    expect(
      screen.getByRole('status', { name: 'Loading metrics' })
    ).toBeInTheDocument()

    expect(screen.queryByTestId('metrics-count')).not.toBeInTheDocument()
    expect(screen.queryByText('No data for this range')).not.toBeInTheDocument()

    unmount()
    localStorage.removeItem('token')
  })
  test('ignores samples from other hosts and malformed messages', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket)
    localStorage.setItem('token', 'test-jwt-token')

    apiFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [] }),
    })

    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { unmount } = render(<Metrics />)

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1)
      expect(apiFetch).toHaveBeenCalledTimes(1)
    })

    const socket = MockWebSocket.instances[0]

    socket.receive(JSON.stringify({ host_id: 2, cpu_usage: 30 }))
    socket.receive('{invalid json')

    expect(apiFetch).toHaveBeenCalledTimes(1)

    unmount()
    localStorage.removeItem('token')
  })
})
describe('Metrics page HTTP error handling', () => {
  test('displays the server error without loading failed metrics data', async () => {
    const json = vi.fn().mockResolvedValue({
      error: 'Database unavailable'
    })

    apiFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json,
    })

    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<Metrics />)

    expect(await screen.findByRole('alert'))
      .toHaveTextContent('Database unavailable')

    expect(json).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('metrics-count')).toHaveTextContent('0')
  })
})

describe('Metrics page loading and empty states', () => {
  test('shows skeleton while the initial metrics request is pending', () => {
    apiFetch.mockReturnValue(new Promise(() => {}))

    render(<Metrics />)

    expect(
      screen.getByRole('status', { name: 'Loading metrics' })
    ).toBeInTheDocument()

    expect(screen.queryByTestId('metrics-count')).not.toBeInTheDocument()
  })

  test('shows empty state when the API successfully returns no metrics', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [] }),
    })

    render(<Metrics />)

    expect(
      await screen.findByText('No data for this range')
    ).toBeInTheDocument()

    expect(screen.queryByTestId('metrics-count')).not.toBeInTheDocument()
  })
})

