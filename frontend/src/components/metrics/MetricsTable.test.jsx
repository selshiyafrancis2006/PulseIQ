import { describe, expect, test } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import MetricsTable from './MetricsTable'

const metric = (id, timestamp, collected_at, cpu_usage) => ({
  id,
  timestamp,
  ...(collected_at ? { collected_at } : {}),
  cpu_usage
})

describe('MetricsTable timestamps', () => {
  test('displays collected_at instead of the server receipt timestamp', () => {
    const collectedAt = '2026-11-03T10:00:00.000Z'
    const receiptTimestamp = '2026-11-03T11:00:00.000Z'

    render(
      <MetricsTable
        metrics={[metric(1, receiptTimestamp, collectedAt, 45)]}
        selectedMetric="cpu_usage"
      />
    )

    const row = screen.getAllByRole('row')[1]

    expect(within(row).getByText(new Date(collectedAt).toLocaleString()))
      .toBeInTheDocument()

    expect(within(row).queryByText(new Date(receiptTimestamp).toLocaleString()))
      .not.toBeInTheDocument()
  })

  test('sorts chronologically using collected_at', () => {
    const metrics = [
      metric(1, '2026-11-03T11:00:00.000Z', '2026-11-03T09:00:00.000Z', 20),
      metric(2, '2026-11-03T10:00:00.000Z', '2026-11-03T10:00:00.000Z', 30)
    ]

    render(
      <MetricsTable metrics={metrics} selectedMetric="cpu_usage" />
    )

    const rows = screen.getAllByRole('row').slice(1)

    expect(within(rows[0]).getByText('30.00%')).toBeInTheDocument()
    expect(within(rows[1]).getByText('20.00%')).toBeInTheDocument()
  })

  test('falls back to timestamp when collected_at is unavailable', () => {
    const timestamp = '2026-11-03T10:00:00.000Z'

    render(
      <MetricsTable
        metrics={[metric(1, timestamp, null, 45)]}
        selectedMetric="cpu_usage"
      />
    )

    expect(
      screen.getByText(new Date(timestamp).toLocaleString())
    ).toBeInTheDocument()
  })

  test('searches using the collection timestamp', () => {
    const collectedAt = '2026-11-03T09:00:00.000Z'
    const receiptTimestamp = '2026-11-03T11:00:00.000Z'

    render(
      <MetricsTable
        metrics={[metric(1, receiptTimestamp, collectedAt, 45)]}
        selectedMetric="cpu_usage"
      />
    )

    const search = screen.getByPlaceholderText('Search timestamp...')

    fireEvent.change(search, {
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
    render(
      <MetricsTable
        metrics={[{ id: 1, timestamp: '2026-11-04T10:00:00.000Z', cpu_usage: value }]}
        selectedMetric="cpu_usage"
      />
    )

    expect(screen.getByText(expectedStatus)).toBeInTheDocument()
  })

  test.each(['network_in', 'network_out'])(
    'does not show percentage status badges for %s',
    (selectedMetric) => {
      render(
        <MetricsTable
          metrics={[{
            id: 1,
            timestamp: '2026-11-04T10:00:00.000Z',
            [selectedMetric]: 1200
          }]}
          selectedMetric={selectedMetric}
        />
      )

      expect(screen.queryByText('Critical')).not.toBeInTheDocument()
      expect(screen.queryByText('Warning')).not.toBeInTheDocument()
      expect(screen.queryByText('Normal')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Status not applicable')).toBeInTheDocument()
    }
  )
})
