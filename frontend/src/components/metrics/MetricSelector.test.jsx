import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import MetricSelector from './MetricSelector'

describe('MetricSelector accessibility', () => {
  test('provides an accessible name for the time-range select', () => {
    render(
      <MetricSelector
        selectedMetrics={['cpu_usage']}
        setSelectedMetrics={vi.fn()}
        timeRange="1m"
        setTimeRange={vi.fn()}
      />
    )

    expect(
      screen.getByRole('combobox', { name: 'Time Range' })
    ).toBeInTheDocument()
  })

  test('provides accessible names for metric checkboxes', () => {
    render(
      <MetricSelector
        selectedMetrics={['cpu_usage']}
        setSelectedMetrics={vi.fn()}
        timeRange="1m"
        setTimeRange={vi.fn()}
      />
    )

    expect(
      screen.getByRole('checkbox', { name: 'CPU Usage' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('checkbox', { name: 'Memory Usage' })
    ).toBeInTheDocument()
  })

  test('updates the selected time range', () => {
    const setTimeRange = vi.fn()

    render(
      <MetricSelector
        selectedMetrics={['cpu_usage']}
        setSelectedMetrics={vi.fn()}
        timeRange="1m"
        setTimeRange={setTimeRange}
      />
    )

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Time Range' }),
      { target: { value: '7d' } }
    )

    expect(setTimeRange).toHaveBeenCalledWith('7d')
  })

  test('disables incompatible steps and P95 for rolled-up ranges', () => {
    render(
      <MetricSelector
        selectedMetrics={['cpu_usage']}
        setSelectedMetrics={vi.fn()}
        timeRange="30d"
        setTimeRange={vi.fn()}
        step="1h"
        setStep={vi.fn()}
        aggregation="avg"
        setAggregation={vi.fn()}
        compatibleSteps={['1h', '6h', '1d']}
        p95Available={false}
      />
    )

    expect(screen.getByRole('option', { name: '1 minute' })).toBeDisabled()
    expect(screen.getByRole('option', { name: '1 hour' })).toBeEnabled()
    expect(screen.getByRole('option', { name: /95th percentile/i })).toBeDisabled()
    expect(screen.getByText(/P95 is unavailable when this range includes rolled-up data/i)).toBeInTheDocument()
  })

  test('allows selecting a custom time range', () => {
    const setTimeRange = vi.fn()

    render(
      <MetricSelector
        selectedMetrics={['cpu_usage']}
        setSelectedMetrics={vi.fn()}
        timeRange="1m"
        setTimeRange={setTimeRange}
      />
    )

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Time Range' }),
      { target: { value: 'custom' } }
    )

    expect(setTimeRange).toHaveBeenCalledWith('custom')
  })

  test('shows custom date/time inputs and updates their values', () => {
    const setCustomFrom = vi.fn()
    const setCustomTo = vi.fn()

    render(
      <MetricSelector
        selectedMetrics={['cpu_usage']}
        setSelectedMetrics={vi.fn()}
        timeRange="custom"
        setTimeRange={vi.fn()}
        customFrom="2026-11-17T10:00"
        setCustomFrom={setCustomFrom}
        customTo="2026-11-18T10:00"
        setCustomTo={setCustomTo}
      />
    )

    const startInput = screen.getByLabelText('Start date/time')
    const endInput = screen.getByLabelText('End date/time')

    expect(startInput).toHaveValue('2026-11-17T10:00')
    expect(endInput).toHaveValue('2026-11-18T10:00')

    fireEvent.change(startInput, {
      target: { value: '2026-11-17T11:00' }
    })
    fireEvent.change(endInput, {
      target: { value: '2026-11-18T11:00' }
    })

    expect(setCustomFrom).toHaveBeenCalledWith('2026-11-17T11:00')
    expect(setCustomTo).toHaveBeenCalledWith('2026-11-18T11:00')
  })

  test('displays custom range validation errors accessibly', () => {
    render(
      <MetricSelector
        selectedMetrics={['cpu_usage']}
        setSelectedMetrics={vi.fn()}
        timeRange="custom"
        setTimeRange={vi.fn()}
        customRangeError="Start must be before end."
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Start must be before end.'
    )
    expect(screen.getByLabelText('Start date/time')).toHaveAttribute(
      'aria-invalid',
      'true'
    )
    expect(screen.getByLabelText('End date/time')).toHaveAttribute(
      'aria-invalid',
      'true'
    )
  })})
