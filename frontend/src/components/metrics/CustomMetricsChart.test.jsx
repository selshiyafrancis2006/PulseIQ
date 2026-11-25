import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import CustomMetricsChart from './CustomMetricsChart'

vi.mock('react-chartjs-2', () => ({
  Line: ({ data }) => (
    <div data-testid="line-chart" data-chart={JSON.stringify(data)} />
  )
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('CustomMetricsChart', () => {
  test('creates separate series for different tag dimensions', () => {
    const metrics = [
      {
        timestamp: '2026-11-23T10:00:00.000Z',
        value: 40,
        unit: '%',
        tags: { mount: '/' }
      },
      {
        timestamp: '2026-11-23T10:00:00.000Z',
        value: 60,
        unit: '%',
        tags: { mount: '/data' }
      }
    ]

    render(<CustomMetricsChart metrics={metrics} metricName="disk.usage" />)

    const chart = JSON.parse(
      screen.getByTestId('line-chart').getAttribute('data-chart')
    )

    expect(chart.datasets).toHaveLength(2)
    expect(chart.datasets.map(series => series.data)).toEqual([[40], [60]])
    expect(chart.datasets.map(series => series.label).join(' '))
      .toContain('mount')
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  test('preserves missing observations as null gaps', () => {
    const metrics = [
      {
        timestamp: '2026-11-23T10:00:00.000Z',
        value: 10,
        unit: 'KB/s',
        tags: { iface: 'eth0' }
      },
      {
        timestamp: '2026-11-23T10:01:00.000Z',
        value: 20,
        unit: 'KB/s',
        tags: { iface: 'eth1' }
      },
      {
        timestamp: '2026-11-23T10:02:00.000Z',
        value: 30,
        unit: 'KB/s',
        tags: { iface: 'eth0' }
      }
    ]

    render(<CustomMetricsChart metrics={metrics} metricName="network.rx" />)

    const chart = JSON.parse(
      screen.getByTestId('line-chart').getAttribute('data-chart')
    )

    expect(chart.labels).toHaveLength(3)
    expect(chart.datasets[0].data).toEqual([10, null, 30])
  })

  test('renders an empty chart when no observations exist', () => {
    const { container } = render(<CustomMetricsChart metrics={[]} metricName="disk.usage" />)

    expect(container.firstChild).toBeNull()
  })
})



