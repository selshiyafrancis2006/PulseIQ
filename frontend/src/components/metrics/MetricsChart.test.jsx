import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import MetricsChart from './MetricsChart'

vi.mock('react-chartjs-2', () => ({
  Line: ({ data }) => (
    <div
      data-testid="line-chart"
      data-chart={JSON.stringify(data)}
    />
  )
}))

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
})