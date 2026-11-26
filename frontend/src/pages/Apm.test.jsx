import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import api from '../services/api'
import useHosts from '../hooks/useHosts'
import Apm from './Apm'

vi.mock('../services/api', () => ({
  default: { get: vi.fn() }
}))

vi.mock('../hooks/useHosts', () => ({
  default: vi.fn()
}))

// Canvas is unavailable in jsdom; expose the chart data instead.
vi.mock('react-chartjs-2', () => ({
  Line: ({ data }) => (
    <div data-testid="line-chart" data-chart={JSON.stringify(data)} />
  )
}))

const stats = (overrides = {}) => ({
  request_count: 101,
  avg_duration_ms: 50,
  max_duration_ms: 100,
  p50_duration_ms: 50,
  p95_duration_ms: 95,
  p99_duration_ms: 99,
  error_count: 4,
  client_error_count: 6,
  error_rate: 3.96,
  ...overrides
})

const series = [
  { bucket: '2026-11-26T10:00:00Z', ...stats({ request_count: 0, p50_duration_ms: null, p95_duration_ms: null, p99_duration_ms: null, error_rate: null, error_count: 0 }), throughput_rpm: 0 },
  { bucket: '2026-11-26T10:01:00Z', ...stats(), throughput_rpm: 101 }
]

// Builds an api.get implementation that answers every APM endpoint
const respond = ({ summary, overview, points } = {}) => (url) => {
  const body = {
    '/apm/traces/summary': summary ?? [{ method: 'GET', route: '/orders', ...stats() }],
    '/apm/traces/overview': overview ?? { range: '1h', ...stats(), throughput_rpm: 1.7 },
    '/apm/traces/timeseries': { range: '1h', bucket_seconds: 60, points: points ?? series },
    '/apm/traces': [
      { id: 1, method: 'GET', route: '/orders', status_code: 200, duration_ms: 12, timestamp: new Date().toISOString() }
    ]
  }[url]

  return Promise.resolve({ data: body })
}

// "/orders" is in both the Routes and the Recent Requests table; the Routes
// table comes first.
const findRoutesRow = async (route = '/orders') =>
  (await screen.findAllByText(route, { selector: 'td' }))[0].closest('tr')

const callsTo = (url) => api.get.mock.calls.filter(([called]) => called === url)

beforeEach(() => {
  api.get.mockReset()
  useHosts.mockReturnValue({
    hosts: [{ id: 1, name: 'web-1' }],
    selectedHostId: 1,
    setSelectedHostId: vi.fn()
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Apm page', () => {
  test('requests every endpoint with the default 1h range', async () => {
    api.get.mockImplementation(respond())

    render(<Apm />)

    await findRoutesRow()

    for (const url of ['/apm/traces/summary', '/apm/traces/overview', '/apm/traces/timeseries']) {
      expect(callsTo(url)[0][1].params).toEqual({ host_id: 1, range: '1h' })
    }
  })

  test('shows percentiles and a 5xx-based error rate per route and overall', async () => {
    api.get.mockImplementation(respond())

    render(<Apm />)

    const row = await findRoutesRow()

    expect(within(row).getByText('50 ms')).toBeInTheDocument()
    expect(within(row).getByText('95 ms')).toBeInTheDocument()
    expect(within(row).getByText('99 ms')).toBeInTheDocument()
    expect(within(row).getByText(/3\.96%/)).toBeInTheDocument()
    expect(within(row).getByText('(4 5xx)')).toBeInTheDocument()

    expect(screen.getByText('1.7 req/min')).toBeInTheDocument()
    expect(screen.getByText('4 server errors (5xx)')).toBeInTheDocument()
  })

  test('draws latency, throughput and error-rate charts, leaving gaps for empty buckets', async () => {
    api.get.mockImplementation(respond())

    render(<Apm />)

    await findRoutesRow()

    const charts = screen.getAllByTestId('line-chart').map((el) => JSON.parse(el.dataset.chart))

    expect(charts).toHaveLength(3)

    const [latency, throughput, errorRate] = charts
    expect(latency.datasets.map((d) => d.label)).toEqual(['p50', 'p95', 'p99'])
    // empty bucket first, then real values: null must stay null, not 0
    expect(latency.datasets[1].data).toEqual([null, 95])
    expect(throughput.datasets[0].data).toEqual([0, 101])
    expect(errorRate.datasets[0].data).toEqual([null, 3.96])
  })

  test('re-requests with the chosen range and updates the heading', async () => {
    api.get.mockImplementation(respond())

    render(<Apm />)

    await findRoutesRow()

    fireEvent.click(screen.getByRole('button', { name: '6h' }))

    await waitFor(() =>
      expect(callsTo('/apm/traces/summary').some(([, config]) => config.params.range === '6h')).toBe(true)
    )

    expect(screen.getByText(/over the last 6 hours/)).toBeInTheDocument()
  })

  test('ignores a slow response for a range that is no longer selected', async () => {
    let releaseSlow
    const slow = new Promise((resolve) => { releaseSlow = resolve })

    api.get.mockImplementation((url, config) => {
      if (url === '/apm/traces/summary' && config.params.range === '1h') {
        return slow
      }

      if (url === '/apm/traces/summary') {
        return Promise.resolve({ data: [{ method: 'GET', route: '/six-hour-route', ...stats() }] })
      }

      return respond()(url, config)
    })

    render(<Apm />)

    // switch away while the 1h summary is still in flight
    fireEvent.click(screen.getByRole('button', { name: '6h' }))

    await screen.findByText('/six-hour-route', { selector: 'td' })

    releaseSlow({ data: [{ method: 'GET', route: '/one-hour-route', ...stats() }] })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.queryByText('/one-hour-route')).not.toBeInTheDocument()
    expect(screen.getByText('/six-hour-route', { selector: 'td' })).toBeInTheDocument()
  })

  test('shows an empty state naming the range when there is no traffic', async () => {
    api.get.mockImplementation(respond({
      summary: [],
      overview: { range: '1h', ...stats({ request_count: 0, error_count: 0, error_rate: null, p50_duration_ms: null, p95_duration_ms: null, p99_duration_ms: null }), throughput_rpm: 0 },
      points: []
    }))

    render(<Apm />)

    expect(await screen.findByText(/No requests recorded for this host in the last hour/)).toBeInTheDocument()
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument()
  })

  test('shows an error message when the first load fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    api.get.mockRejectedValue(new Error('boom'))

    render(<Apm />)

    expect(await screen.findByText(/Couldn't load APM data/)).toBeInTheDocument()
  })
})