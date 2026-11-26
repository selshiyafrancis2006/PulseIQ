import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { apiFetch } from '../../utils/apiFetch'
import ApmSummaryWidget from './ApmSummaryWidget'

vi.mock('../../utils/apiFetch', () => ({
  apiFetch: vi.fn(),
}))

const routes = [
  { request_count: '10', error_count: '1', avg_duration_ms: '100.0' },
  { request_count: '30', error_count: '2', avg_duration_ms: '200.0' },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ApmSummaryWidget', () => {
  test('requests the dashboard time range and shows weighted totals', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => routes,
    })

    render(<ApmSummaryWidget hostId={3} timeRange="6h" />)

    await waitFor(() => expect(screen.getByText('40')).toBeInTheDocument())

    const url = apiFetch.mock.calls[0][0]
    expect(url).toContain('host_id=3')
    expect(url).toContain('range=6h')

    expect(screen.getByText('175ms')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Last 6 hours')).toBeInTheDocument()
  })

  test('falls back to one hour for an unknown range', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    })

    render(<ApmSummaryWidget hostId={3} timeRange="bogus" />)

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    expect(apiFetch.mock.calls[0][0]).toContain('range=1h')
  })

  test('shows the server error instead of an empty state', async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Failed to fetch route summary' }),
    })

    render(<ApmSummaryWidget hostId={3} timeRange="1h" />)

    await waitFor(() =>
      expect(
        screen.getByText(/Failed to fetch route summary/)
      ).toBeInTheDocument()
    )
  })

  test('shows a message instead of skeletons when no host is set', () => {
    render(<ApmSummaryWidget hostId={null} timeRange="1h" />)

    expect(screen.getByText('No host selected')).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })
})
