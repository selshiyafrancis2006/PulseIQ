import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import MetricsChart from './MetricsChart'

vi.mock('react-chartjs-2', () => ({
  Line: ({ data }) => (
    <div
      data-testid="line-chart"
      data-chart={JSON.stringify(data)}
    />
  )
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('MetricsChart chart data', () => {
  test('uses collection timestamps and preserves missing intervals as null gaps', () => {
    const now = Date.now()
    const collectedAt = (secondsAgo) =>
      new Date(now - secondsAgo * 1000).toISOString()

    const receiptTimestamp = new Date(now).toISOString()

    const metrics = [
      { timestamp: receiptTimestamp, collected_at: collectedAt(20), cpu_usage: 50 },
      { timestamp: receiptTimestamp, collected_at: collectedAt(40), cpu_usage: 10 },
      { timestamp: receiptTimestamp, collected_at: collectedAt(25), cpu_usage: 40 },
      { timestamp: receiptTimestamp, collected_at: collectedAt(35), cpu_usage: 20 }
    ]

    render(
      <MetricsChart
        metrics={metrics}
        selectedMetrics={['cpu_usage']}
        timeRange="1m"
      />
    )

    const chart = screen.getByTestId('line-chart')
    const chartData = JSON.parse(chart.getAttribute('data-chart'))

    expect(chartData.datasets[0].data).toEqual([10, 20, null, 40, 50])
  })

  test('renders all metrics returned by the API without applying a second time filter', () => {
    const metrics = [
      {
        timestamp: '2026-11-03T09:58:00.000Z',
        cpu_usage: 50
      }
    ]

    render(
      <MetricsChart
        metrics={metrics}
        selectedMetrics={['cpu_usage']}
        timeRange="1m"
      />
    )

    const chart = screen.getByTestId('line-chart')
    const chartData = JSON.parse(chart.getAttribute('data-chart'))

    expect(chartData.datasets[0].data).toEqual([50])
  })
})


describe('MetricsChart accessibility', () => {
  test('provides a text alternative describing the selected metric and latest value', () => {
    const metrics = [
      {
        timestamp: '2026-11-17T06:00:00.000Z',
        cpu_usage: 50
      }
    ]

    render(
      <MetricsChart
        metrics={metrics}
        selectedMetrics={['cpu_usage']}
        timeRange="1m"
      />
    )

    const chart = screen.getByRole('img')

    expect(chart).toHaveAccessibleName(
      expect.stringContaining('Cpu Usage')
    )
    expect(chart).toHaveAccessibleName(
      expect.stringContaining('1 minute')
    )
    expect(chart).toHaveAccessibleName(
      expect.stringContaining('1 recorded sample')
    )
    expect(chart).toHaveAccessibleName(
      expect.stringContaining('50.00%')
    )
  })
})


describe('MetricsChart host comparison', () => {
  const hosts = [
    { id: 1, name: 'Production' },
    { id: 2, name: 'Staging' }
  ]

  const metrics = [
    {
      host_id: 1,
      collected_at: '2026-11-17T06:00:00.000Z',
      cpu_usage: 50
    },
    {
      host_id: 2,
      collected_at: '2026-11-17T06:00:00.000Z',
      cpu_usage: 70
    }
  ]

  const renderComparison = () => render(
    <MetricsChart
      metrics={metrics}
      selectedMetrics={['cpu_usage']}
      timeRange="1m"
      primaryHostId={1}
      hosts={hosts}
      comparisonHostIds={[2]}
    />
  )

  test('renders separate datasets with host names, values, and distinct colours', () => {
    renderComparison()

    const chartData = JSON.parse(
      screen.getByTestId('line-chart').getAttribute('data-chart')
    )

    expect(chartData.datasets).toHaveLength(2)
    expect(chartData.datasets.map(dataset => dataset.label)).toEqual([
      'Production · CPU USAGE',
      'Staging · CPU USAGE'
    ])
    expect(chartData.datasets.map(dataset => dataset.data)).toEqual([
      [50],
      [70]
    ])
    expect(chartData.datasets[0].borderColor).not.toBe(
      chartData.datasets[1].borderColor
    )
  })

  test('uses distinct metric line patterns and the right axis for network metrics', () => {
    const comparisonMetrics = [
      {
        host_id: 1,
        collected_at: '2026-11-17T06:00:00.000Z',
        cpu_usage: 50,
        memory_usage: 60,
        network_in: 20
      },
      {
        host_id: 2,
        collected_at: '2026-11-17T06:00:00.000Z',
        cpu_usage: 70,
        memory_usage: 80,
        network_in: 30
      }
    ]

    render(
      <MetricsChart
        metrics={comparisonMetrics}
        selectedMetrics={['cpu_usage', 'memory_usage', 'network_in']}
        timeRange="1m"
        primaryHostId={1}
        hosts={hosts}
        comparisonHostIds={[2]}
      />
    )

    const chartData = JSON.parse(
      screen.getByTestId('line-chart').getAttribute('data-chart')
    )
    const datasets = chartData.datasets

    expect(datasets).toHaveLength(6)

    expect(datasets.map(dataset => dataset.yAxisID)).toEqual([
      'y',
      'y',
      'yNetwork',
      'y',
      'y',
      'yNetwork'
    ])

    expect(datasets.map(dataset => dataset.borderDash)).toEqual([
      [],
      [6, 3],
      [2, 3],
      [],
      [6, 3],
      [2, 3]
    ])

    expect(new Set(datasets.slice(0, 3).map(dataset => dataset.borderColor)).size).toBe(1)
    expect(new Set(datasets.slice(3, 6).map(dataset => dataset.borderColor)).size).toBe(1)
    expect(datasets[0].borderColor).not.toBe(datasets[3].borderColor)
  })
  test('describes both hosts and their latest values accessibly', () => {
    renderComparison()

    const chart = screen.getByRole('img')

    expect(chart).toHaveAccessibleName(
      expect.stringContaining('Production, Staging')
    )
    expect(chart).toHaveAccessibleName(
      expect.stringContaining('Production · CPU USAGE: 50.00%')
    )
    expect(chart).toHaveAccessibleName(
      expect.stringContaining('Staging · CPU USAGE: 70.00%')
    )
  })
})

