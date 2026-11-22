import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { apiFetch } from '../utils/apiFetch'
import useHosts from '../hooks/useHosts'
import Processes from './Processes'

vi.mock('../utils/apiFetch', () => ({
  apiFetch: vi.fn(),
}))

vi.mock('../hooks/useHosts', () => ({
  default: vi.fn(),
}))

const hostsState = (overrides = {}) => ({
  hosts: [
    { id: 1, name: 'web-1' },
    { id: 2, name: 'db-1' },
  ],
  selectedHostId: 1,
  setSelectedHostId: vi.fn(),
  loading: false,
  ...overrides,
})

const snapshot = (overrides = {}) => ({
  host_id: 1,
  collected_at: new Date().toISOString(),
  processes: [
    { pid: 11, name: 'nginx', cpu: 5.5, memory: 120, status: 'Running' },
    { pid: 22, name: 'cron', cpu: 0, memory: 8, status: 'Sleeping' },
  ],
  ...overrides,
})

// Names also appear in the "highest memory / CPU" cards, so look in the table
const inTable = () => within(screen.getByRole('table'))
const findInTable = (text) =>
  waitFor(() => expect(inTable().getByText(text)).toBeInTheDocument())

const respondWith = (body) =>
  apiFetch.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(body) })

beforeEach(() => {
  apiFetch.mockReset()
  useHosts.mockReturnValue(hostsState())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Processes page', () => {
  test("loads the selected host's processes from the per-host endpoint", async () => {
    respondWith(snapshot())

    render(<Processes />)

    await findInTable('nginx')
    expect(inTable().getByText('cron')).toBeInTheDocument()
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(apiFetch.mock.calls[0][0]).toMatch(/\/api\/hosts\/1\/processes$/)
    expect(screen.getByTestId('processes-updated')).toHaveTextContent('Reported')
  })

  test('never calls the old server-wide endpoint', async () => {
    respondWith(snapshot())

    render(<Processes />)
    await findInTable('nginx')

    for (const [url] of apiFetch.mock.calls) {
      expect(url).not.toMatch(/\/api\/processes$/)
    }
  })

  test('explains when the host has not reported processes yet', async () => {
    respondWith({ host_id: 1, collected_at: null, processes: [] })

    render(<Processes />)

    expect(
      await screen.findByText(/has not reported any processes yet/i)
    ).toBeInTheDocument()
  })

  test('warns when the list is more than 2 minutes old', async () => {
    respondWith(snapshot({ collected_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() }))

    render(<Processes />)

    expect(await screen.findByText(/more than 2 minutes old/i)).toBeInTheDocument()
    expect(screen.getByTestId('processes-updated')).toHaveTextContent('Last reported')
  })

  test('shows an error and keeps the page usable when the request fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    apiFetch.mockResolvedValue({ ok: false, status: 500, json: vi.fn() })

    render(<Processes />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load processes/i)
  })

  test('fetches the other host when the selection changes', async () => {
    respondWith(snapshot())

    const { rerender } = render(<Processes />)
    await findInTable('nginx')

    respondWith(
      snapshot({
        host_id: 2,
        processes: [{ pid: 7, name: 'postgres', cpu: 3, memory: 300, status: 'Running' }],
      })
    )
    useHosts.mockReturnValue(hostsState({ selectedHostId: 2 }))
    rerender(<Processes />)

    await findInTable('postgres')
    expect(inTable().queryByText('nginx')).not.toBeInTheDocument()
    expect(apiFetch.mock.calls.at(-1)[0]).toMatch(/\/api\/hosts\/2\/processes$/)
  })

  test('shows a message and fetches nothing when there are no hosts', () => {
    useHosts.mockReturnValue(hostsState({ hosts: [], selectedHostId: null }))

    render(<Processes />)

    expect(screen.getByText(/No hosts yet/i)).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  test('filters the loaded processes by search text', async () => {
    respondWith(snapshot())

    render(<Processes />)
    await findInTable('nginx')

    fireEvent.change(screen.getByPlaceholderText(/Search PID or Process/i), {
      target: { value: 'cron' },
    })

    await waitFor(() => {
      expect(inTable().queryByText('nginx')).not.toBeInTheDocument()
    })
    expect(inTable().getByText('cron')).toBeInTheDocument()
  })
})