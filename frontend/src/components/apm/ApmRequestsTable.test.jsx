import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import api from '../../services/api'
import ApmRequestsTable from './ApmRequestsTable'

vi.mock('../../services/api', () => ({
  default: { get: vi.fn() }
}))

const trace = (id, overrides = {}) => ({
  id,
  method: 'GET',
  route: `/route-${id}`,
  status_code: 200,
  duration_ms: id * 10,
  timestamp: '2026-11-26T10:00:00Z',
  ...overrides
})

const page = (items, overrides = {}) => ({
  items,
  page: 1,
  page_size: 25,
  total: items.length,
  total_pages: 1,
  ...overrides
})

const lastParams = () => api.get.mock.calls[api.get.mock.calls.length - 1][1].params

beforeEach(() => {
  api.get.mockReset()
  api.get.mockResolvedValue({ data: page([trace(1), trace(2)]) })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ApmRequestsTable', () => {
  test('loads the latest requests for the host and range', async () => {
    render(<ApmRequestsTable hostId={7} range="6h" />)

    expect(await screen.findByText('/route-1')).toBeInTheDocument()

    expect(api.get).toHaveBeenCalledWith('/apm/traces', {
      params: {
        host_id: 7,
        range: '6h',
        page: 1,
        page_size: 25,
        sort: 'timestamp',
        order: 'desc'
      }
    })
  })

  test('the Slowest and Failing views set sort and status', async () => {
    render(<ApmRequestsTable hostId={1} range="1h" />)
    await screen.findByText('/route-1')

    fireEvent.click(screen.getByRole('button', { name: 'Slowest' }))
    await waitFor(() => expect(lastParams()).toMatchObject({ sort: 'duration', order: 'desc' }))
    expect(lastParams().status).toBeUndefined()
    expect(screen.getByRole('button', { name: 'Slowest' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Failing' }))
    await waitFor(() => expect(lastParams()).toMatchObject({ sort: 'timestamp', status: '5xx' }))
    expect(screen.getByRole('button', { name: 'Failing' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Slowest' })).toHaveAttribute('aria-pressed', 'false')
  })

  test('applies method, status, route and minimum duration filters', async () => {
    render(<ApmRequestsTable hostId={1} range="1h" />)
    await screen.findByText('/route-1')

    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'POST' } })
    await waitFor(() => expect(lastParams().method).toBe('POST'))

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'error' } })
    await waitFor(() => expect(lastParams().status).toBe('error'))

    fireEvent.change(screen.getByLabelText('Route'), { target: { value: '  /api/orders  ' } })
    fireEvent.change(screen.getByLabelText('Minimum duration in milliseconds'), { target: { value: '250' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() =>
      expect(lastParams()).toMatchObject({
        method: 'POST',
        status: 'error',
        route: '/api/orders',
        min_duration_ms: '250'
      })
    )
  })

  test('does not send a minimum duration that is not a whole number', async () => {
    render(<ApmRequestsTable hostId={1} range="1h" />)
    await screen.findByText('/route-1')

    fireEvent.change(screen.getByLabelText('Minimum duration in milliseconds'), { target: { value: '-5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(screen.getByText('/route-1')).toBeInTheDocument())
    expect(lastParams().min_duration_ms).toBeUndefined()
  })

  test('clicking a column header sorts by it and flips the direction', async () => {
    render(<ApmRequestsTable hostId={1} range="1h" />)
    await screen.findByText('/route-1')

    fireEvent.click(screen.getByRole('button', { name: /^Duration/ }))
    await waitFor(() => expect(lastParams()).toMatchObject({ sort: 'duration', order: 'desc' }))

    fireEvent.click(screen.getByRole('button', { name: /^Duration/ }))
    await waitFor(() => expect(lastParams()).toMatchObject({ sort: 'duration', order: 'asc' }))

    expect(screen.getByRole('button', { name: /^Duration/ }).closest('th'))
      .toHaveAttribute('aria-sort', 'ascending')
  })

  test('pages through results and returns to page 1 when a filter changes', async () => {
    api.get.mockResolvedValue({
      data: page([trace(1)], { total: 60, total_pages: 3 })
    })

    render(<ApmRequestsTable hostId={1} range="1h" />)

    expect(await screen.findByText(/Page 1 of 3/)).toBeInTheDocument()
    expect(screen.getByText(/60 requests/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

    api.get.mockResolvedValue({
      data: page([trace(2)], { page: 2, total: 60, total_pages: 3 })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText(/Page 2 of 3/)).toBeInTheDocument()
    expect(lastParams().page).toBe(2)
    expect(screen.getByRole('button', { name: 'Previous' })).not.toBeDisabled()

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: '5xx' } })

    await waitFor(() => expect(lastParams()).toMatchObject({ status: '5xx', page: 1 }))
  })

  test('disables Next on the last page', async () => {
    api.get.mockResolvedValue({
      data: page([trace(1)], { page: 3, total: 60, total_pages: 3 })
    })

    render(<ApmRequestsTable hostId={1} range="1h" />)

    expect(await screen.findByText(/Page 3 of 3/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  test('pinned to a route it hides the method and route filters and always sends them', async () => {
    render(
      <ApmRequestsTable hostId={1} range="1h" fixedMethod="POST" fixedRoute="/orders" />
    )

    await screen.findByText('/route-1')

    expect(screen.queryByLabelText('Method')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Route')).not.toBeInTheDocument()
    expect(lastParams()).toMatchObject({ method: 'POST', route: '/orders' })
  })

  test('shows an empty state when nothing matches', async () => {
    api.get.mockResolvedValue({ data: page([]) })

    render(<ApmRequestsTable hostId={1} range="1h" />)

    expect(await screen.findByText('No requests match these filters.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
  })

  test('offers a way back when the current page no longer exists', async () => {
    api.get.mockResolvedValue({
      data: page([], { page: 5, total: 10, total_pages: 1 })
    })

    render(<ApmRequestsTable hostId={1} range="1h" />)

    expect(await screen.findByText(/no requests on this page/)).toBeInTheDocument()

    api.get.mockResolvedValue({ data: page([trace(1)], { total: 10, total_pages: 1 }) })
    fireEvent.click(screen.getByRole('button', { name: 'Go to the first page' }))

    await waitFor(() => expect(lastParams().page).toBe(1))
  })

  test('ignores a slow response for filters that are no longer selected', async () => {
    let releaseSlow
    const slow = new Promise((resolve) => { releaseSlow = resolve })

    api.get.mockImplementation((url, { params }) =>
      params.status === '5xx'
        ? Promise.resolve({ data: page([trace(2, { route: '/failing-route' })]) })
        : slow
    )

    render(<ApmRequestsTable hostId={1} range="1h" />)

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: '5xx' } })
    await screen.findByText('/failing-route')

    releaseSlow({ data: page([trace(1, { route: '/stale-route' })]) })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.queryByText('/stale-route')).not.toBeInTheDocument()
    expect(screen.getByText('/failing-route')).toBeInTheDocument()
  })

  test('shows an error message when loading fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    api.get.mockRejectedValue(new Error('boom'))

    render(<ApmRequestsTable hostId={1} range="1h" />)

    expect(await screen.findByText(/Couldn't load requests/)).toBeInTheDocument()
  })
})