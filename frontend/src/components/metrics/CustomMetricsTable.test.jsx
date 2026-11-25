import { describe, expect, test } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import CustomMetricsTable from './CustomMetricsTable'

describe('CustomMetricsTable', () => {
  test('displays timestamp, value, unit, dimensions, and sample count', () => {
    const timestamp = '2026-11-23T10:00:00.000Z'

    render(
      <CustomMetricsTable
        metrics={[{
          timestamp,
          value: 45.5,
          unit: '%',
          tags: { mount: '/', device: 'sda1' },
          sample_count: 3,
          latest_sample_timestamp: timestamp
        }]}
      />
    )

    const row = screen.getAllByRole('row')[1]

    expect(within(row).getAllByText(new Date(timestamp).toLocaleString()))
      .toHaveLength(2)
    expect(within(row).getByText('45.5')).toBeInTheDocument()
    expect(within(row).getByText('%')).toBeInTheDocument()
    expect(within(row).getByText(/mount: \//)).toBeInTheDocument()
    expect(within(row).getByText('3')).toBeInTheDocument()
  })

  test('handles empty dimensions and invalid timestamps safely', () => {
    render(
      <CustomMetricsTable
        metrics={[{
          timestamp: 'invalid',
          value: 12,
          unit: 'KB/s',
          tags: {},
          sample_count: 1,
          latest_sample_timestamp: null
        }]}
      />
    )

    const row = screen.getAllByRole('row')[1]

    expect(within(row).getAllByText('—')).toHaveLength(3)
    expect(within(row).getByText('12')).toBeInTheDocument()
  })

  test('renders nothing when there are no observations', () => {
    const { container } = render(<CustomMetricsTable metrics={[]} />)

    expect(container.firstChild).toBeNull()
  })
})

