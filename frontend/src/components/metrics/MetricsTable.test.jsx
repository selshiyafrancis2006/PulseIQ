import { describe, expect, test } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import MetricsTable from './MetricsTable'

const metric = (id, timestamp, collected_at, cpu_usage) => ({
  id,
  timestamp,
  ...(collected_at ? { collected_at } : {}),
  cpu_usage
})

const renderTable = (metrics, selectedMetrics = ['cpu_usage']) =>
  render(
    <MetricsTable metrics={metrics} selectedMetrics={selectedMetrics} />
  )

describe('MetricsTable timestamps', () => {
  test('displays collected_at instead of the server receipt timestamp', () => {
    const collectedAt = '2026-11-03T10:00:00.000Z'
    const receiptTimestamp = '2026-11-03T11:00:00.000Z'

    renderTable([metric(1, receiptTimestamp, collectedAt, 45)])

    const row = screen.getAllByRole('row')[1]

    expect(within(row).getByText(new Date(collectedAt).toLocaleString()))
      .toBeInTheDocument()

    expect(within(row).queryByText(new Date(receiptTimestamp).toLocaleString()))
      .not.toBeInTheDocument()
  })

  test('sorts chronologically using collected_at', () => {
    renderTable([
      metric(1, '2026-11-03T11:00:00.000Z', '2026-11-03T09:00:00.000Z', 20),
      metric(2, '2026-11-03T10:00:00.000Z', '2026-11-03T10:00:00.000Z', 30)
    ])

    const rows = screen.getAllByRole('row').slice(1)

    expect(within(rows[0]).getByText('30.00%')).toBeInTheDocument()
    expect(within(rows[1]).getByText('20.00%')).toBeInTheDocument()
  })

  test('falls back to timestamp when collected_at is unavailable', () => {
    const timestamp = '2026-11-03T10:00:00.000Z'

    renderTable([metric(1, timestamp, null, 45)])

    expect(
      screen.getByText(new Date(timestamp).toLocaleString())
    ).toBeInTheDocument()
  })

  test('searches using the collection timestamp', () => {
    const collectedAt = '2026-11-03T09:00:00.000Z'
    const receiptTimestamp = '2026-11-03T11:00:00.000Z'

    renderTable([metric(1, receiptTimestamp, collectedAt, 45)])

    fireEvent.change(screen.getByPlaceholderText('Search timestamp...'), {
      target: { value: new Date(collectedAt).toLocaleString() }
    })

    expect(screen.getByText('45.00%')).toBeInTheDocument()
  })
})

describe('MetricsTable metric status', () => {
  test.each([
    [74.99, 'Normal'],
    [75, 'Warning'],
    [89.99, 'Warning'],
    [90, 'Critical']
  ])('shows the correct CPU status at %s%%', (value, expectedStatus) => {
    renderTable([
      { id: 1, timestamp: '2026-11-04T10:00:00.000Z', cpu_usage: value }
    ])

    expect(screen.getByText(expectedStatus)).toBeInTheDocument()
  })

  test.each(['network_in', 'network_out'])(
    'does not show percentage status badges for %s',
    (metricName) => {
      renderTable(
        [{
          id: 1,
          timestamp: '2026-11-04T10:00:00.000Z',
          [metricName]: 1200
        }],
        [metricName]
      )

      expect(screen.queryByText('Critical')).not.toBeInTheDocument()
      expect(screen.queryByText('Warning')).not.toBeInTheDocument()
      expect(screen.queryByText('Normal')).not.toBeInTheDocument()
      expect(screen.getByText('1.2 MB/s')).toBeInTheDocument()
    }
  )
})

describe('MetricsTable with several selected metrics', () => {
  const row = {
    id: 1,
    timestamp: '2026-11-04T10:00:00.000Z',
    cpu_usage: 95,
    memory_usage: 40,
    network_in: 512
  }

  test('shows one column per selected metric, in the selected order', () => {
    renderTable([row], ['memory_usage', 'cpu_usage', 'network_in'])

    const headers = screen
      .getAllByRole('columnheader')
      .map(header => header.textContent)

    expect(headers).toEqual([
      'Time',
      'Memory Usage',
      'CPU Usage',
      'Incoming Network'
    ])
  })

  test('shows each metric value and applies its own status', () => {
    renderTable([row], ['cpu_usage', 'memory_usage', 'network_in'])

    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell')

    expect(within(cells[1]).getByText('95.00%')).toBeInTheDocument()
    expect(within(cells[1]).getByText('Critical')).toBeInTheDocument()

    expect(within(cells[2]).getByText('40.00%')).toBeInTheDocument()
    expect(within(cells[2]).getByText('Normal')).toBeInTheDocument()

    expect(within(cells[3]).queryByText(/Critical|Warning|Normal/))
      .not.toBeInTheDocument()
  })

  test('shows a dash for a metric missing from a row', () => {
    renderTable(
      [{ id: 1, timestamp: '2026-11-04T10:00:00.000Z', cpu_usage: 50 }],
      ['cpu_usage', 'memory_usage']
    )

    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell')

    expect(cells[2]).toHaveTextContent('—')
  })

  test('ranks Highest and Lowest by the first selected metric, missing values last', () => {
    renderTable(
      [
        { id: 1, timestamp: '2026-11-04T10:00:00.000Z', memory_usage: 30 },
        { id: 2, timestamp: '2026-11-04T10:01:00.000Z' },
        { id: 3, timestamp: '2026-11-04T10:02:00.000Z', memory_usage: 80 }
      ],
      ['memory_usage', 'cpu_usage']
    )

    const select = screen.getByRole('combobox')

    expect(
      screen.getByRole('option', { name: 'Highest Memory Usage' })
    ).toBeInTheDocument()

    const firstColumn = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map(r => within(r).getAllByRole('cell')[1].textContent)

    fireEvent.change(select, { target: { value: 'highest' } })
    expect(firstColumn()[0]).toContain('80.00%')
    expect(firstColumn()[2]).toBe('—')

    fireEvent.change(select, { target: { value: 'lowest' } })
    expect(firstColumn()[0]).toContain('30.00%')
    expect(firstColumn()[2]).toBe('—')
  })
})