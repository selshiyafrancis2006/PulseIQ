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
  test('does not parse or display a failed metrics response', async () => {
    const json = vi.fn()
    apiFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json,
    })

    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<Metrics />)

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(1)
    })

    expect(json).not.toHaveBeenCalled()
    expect(screen.getByTestId('metrics-count')).toHaveTextContent('0')
  })
})