import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { apiFetch } from '../../utils/apiFetch'
import MetricChartWidget from './MetricChartWidget'

vi.mock('../../utils/apiFetch', () => ({
  apiFetch: vi.fn(),
}))

vi.mock('react-chartjs-2', () => ({
  Line: ({ data }) => (
    <div
      data-testid="line-chart"
      data-chart={JSON.stringify(data)}
    />
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MetricChartWidget HTTP error handling', () => {
  test('shows the empty state without parsing a failed response', async () => {
    const json = vi.fn()
    apiFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json,
    })

    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <MetricChartWidget
        hostId={1}
        metric="cpu_usage"
        hostName="test-host"
        timeRange="1m"
      />
    )

    await waitFor(() => {
      expect(screen.getByText('No data yet')).toBeInTheDocument()
    })

    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(json).not.toHaveBeenCalled()
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument()
  })
})

describe('MetricChartWidget chart data', () => {
  test('uses collection timestamps and renders missing intervals as null gaps', async () => {
    const now = Date.now()
    const collectedAt = (secondsAgo) =>
      new Date(now - secondsAgo * 1000).toISOString()

    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { timestamp: new Date(now).toISOString(), collected_at: collectedAt(40), cpu_usage: 10 },
        { timestamp: new Date(now).toISOString(), collected_at: collectedAt(35), cpu_usage: 20 },
        { timestamp: new Date(now).toISOString(), collected_at: collectedAt(25), cpu_usage: 40 },
        { timestamp: new Date(now).toISOString(), collected_at: collectedAt(20), cpu_usage: 50 }
      ]
    })

    render(
      <MetricChartWidget
        hostId={1}
        metric="cpu_usage"
        hostName="test-host"
        timeRange="1m"
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('line-chart')).toBeInTheDocument()
    })

    const chartData = JSON.parse(
      screen.getByTestId('line-chart').getAttribute('data-chart')
    )

    expect(chartData.datasets[0].data).toEqual([10, 20, null, 40, 50])
  })
})