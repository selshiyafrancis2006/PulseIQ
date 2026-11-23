import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import CustomMetricsExplorer from './CustomMetricsExplorer'
import { apiFetch } from '../../utils/apiFetch'

vi.mock('../../utils/apiFetch', () => ({
  apiFetch: vi.fn()
}))

vi.mock('./CustomMetricsChart', () => ({
  default: ({ metrics, metricName }) => (
    <div data-testid="custom-chart">
      {metricName}:{metrics.length}
    </div>
  )
}))

vi.mock('./CustomMetricsTable', () => ({
  default: ({ metrics }) => (
    <div data-testid="custom-table">{metrics.length}</div>
  )
}))

vi.mock('./MetricsSkeleton', () => ({
  default: () => <div data-testid="metrics-skeleton" />
}))

const discoveredMetrics = [
  {
    metric_name: 'disk.usage',
    unit: '%',
    sample_count: 12,
    latest_sample_timestamp: '2026-11-23T10:00:00.000Z'
  },
  {
    metric_name: 'network.rx',
    unit: 'KB/s',
    sample_count: 8,
    latest_sample_timestamp: '2026-11-23T10:00:00.000Z'
  }
]

const observations = [
  {
    timestamp: '2026-11-23T10:00:00.000Z',
    value: 45,
    unit: '%',
    tags: { mount: '/' },
    sample_count: 3,
    latest_sample_timestamp: '2026-11-23T10:00:00.000Z'
  }
]

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
})

beforeEach(() => {
  vi.clearAllMocks()

  apiFetch.mockImplementation(url => {
    if (url.includes('/custom/names')) {
      return Promise.resolve(jsonResponse({ metrics: discoveredMetrics }))
    }

    if (url.includes('/api/metrics/custom?')) {
      return Promise.resolve(jsonResponse({ data: observations }))
    }

    return Promise.resolve(jsonResponse({}, 404))
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('CustomMetricsExplorer', () => {
  test('discovers metrics for the selected host', async () => {
    render(<CustomMetricsExplorer hostId={7} hostName="Test Host" />)

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/metrics/custom/names?host_id=7')
      )
    })

    expect(await screen.findByRole('option', {
      name: 'disk.usage (%)'
    })).toBeInTheDocument()

    expect(screen.getByRole('option', {
      name: 'network.rx (KB/s)'
    })).toBeInTheDocument()
  })

  test('queries the selected metric and renders chart and table', async () => {
    render(<CustomMetricsExplorer hostId={7} hostName="Test Host" />)

    expect(await screen.findByTestId('custom-chart'))
      .toHaveTextContent('disk.usage:1')

    expect(screen.getByTestId('custom-table')).toHaveTextContent('1')

    const queryCall = apiFetch.mock.calls.find(([url]) =>
      url.includes('/api/metrics/custom?')
    )

    expect(queryCall).toBeDefined()

    const requestUrl = new URL(queryCall[0], 'http://localhost')
    expect(requestUrl.searchParams.get('host_id')).toBe('7')
    expect(requestUrl.searchParams.get('metric_name')).toBe('disk.usage')
    expect(requestUrl.searchParams.get('step')).toBe('1m')
    expect(requestUrl.searchParams.get('agg')).toBe('avg')
    expect(requestUrl.searchParams.get('from')).toBeTruthy()
    expect(requestUrl.searchParams.get('to')).toBeTruthy()
  })

  test('fetches new observations when the selected metric changes', async () => {
    render(<CustomMetricsExplorer hostId={7} hostName="Test Host" />)

    await screen.findByTestId('custom-chart')

    fireEvent.change(screen.getByLabelText('Discovered Metric'), {
      target: { value: 'network.rx' }
    })

    await waitFor(() => {
      expect(screen.getByTestId('custom-chart'))
        .toHaveTextContent('network.rx:1')
    })

    await waitFor(() => {
      const calls = apiFetch.mock.calls.filter(([url]) =>
        url.includes('/api/metrics/custom?')
      )

      expect(calls.some(([url]) =>
        new URL(url, 'http://localhost').searchParams.get('metric_name') === 'network.rx'
      )).toBe(true)
    })
  })

  test('shows an empty state when no custom metrics are discovered', async () => {
    apiFetch.mockImplementation(() =>
      Promise.resolve(jsonResponse({ metrics: [] }))
    )

    render(<CustomMetricsExplorer hostId={7} hostName="Test Host" />)

    expect(await screen.findByText(/No custom metrics have been discovered/i))
      .toBeInTheDocument()

    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  test('prompts the user to select a host when no host is selected', () => {
    render(<CustomMetricsExplorer hostId={null} hostName="" />)

    expect(screen.getByText(/Select a host to discover its custom metrics/i))
      .toBeInTheDocument()

    expect(apiFetch).not.toHaveBeenCalled()
  })
  test('rejects a future custom range without querying observations', async () => {
    render(<CustomMetricsExplorer hostId={7} hostName="Test Host" />)

    await screen.findByRole('option', { name: 'disk.usage (%)' })

    const initialQueryCount = apiFetch.mock.calls.filter(([url]) =>
      url.includes('/api/metrics/custom?')
    ).length

    fireEvent.change(screen.getByLabelText('Time Range'), {
      target: { value: 'custom' }
    })

    fireEvent.change(screen.getByLabelText('Start date/time'), {
      target: { value: '2099-01-01T10:00' }
    })

    fireEvent.change(screen.getByLabelText('End date/time'), {
      target: { value: '2099-01-01T11:00' }
    })

    expect(await screen.findByRole('alert'))
      .toHaveTextContent('End time cannot be in the future.')

    const finalQueryCount = apiFetch.mock.calls.filter(([url]) =>
      url.includes('/api/metrics/custom?')
    ).length

    expect(finalQueryCount).toBe(initialQueryCount)
  })
})



