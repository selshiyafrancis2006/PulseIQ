import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { apiFetch } from '../utils/apiFetch'
import Metrics from './Metrics'

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
})

afterEach(() => {
  vi.restoreAllMocks()
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