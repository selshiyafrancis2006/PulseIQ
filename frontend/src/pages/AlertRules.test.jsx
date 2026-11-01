import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AlertRules from './AlertRules'
import { getAlertRules, updateAlertRule } from '../services/alert.service'

vi.mock('../services/alert.service', () => ({
  getAlertRules: vi.fn(),
  updateAlertRule: vi.fn(),
}))

const rules = [
  {
    id: 1,
    metric_name: 'cpu_usage',
    operator: '>',
    threshold: 80,
    severity: 'critical',
    is_active: true,
  },
  {
    id: 2,
    metric_name: 'memory_usage',
    operator: '>',
    threshold: 70,
    severity: 'warning',
    is_active: false,
  },
  {
    id: 3,
    metric_name: 'disk_usage',
    operator: '>',
    threshold: 90,
    severity: 'critical',
    is_active: true,
  },
  {
    id: 4,
    metric_name: 'network_in',
    operator: '>',
    threshold: 50,
    severity: 'info',
    is_active: false,
  },
]

function renderPage() {
  return render(<AlertRules />)
}

function getRuleNames(container) {
  return Array.from(container.querySelectorAll('h3'))
    .map(element => element.textContent.trim())
}

describe('AlertRules page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAlertRules.mockResolvedValue(rules)
  })

  it('shows the loading state while rules are being fetched', async () => {
    let resolveRequest

    getAlertRules.mockReturnValue(
      new Promise(resolve => {
        resolveRequest = resolve
      })
    )

    renderPage()

    expect(screen.getByText('Loading...')).toBeInTheDocument()

    resolveRequest([])

    expect(
      await screen.findByText('No matching alert rules found.')
    ).toBeInTheDocument()
  })

  it('fetches and renders alert rules', async () => {
    renderPage()

    expect(await screen.findByText('CPU Usage')).toBeInTheDocument()
    expect(screen.getByText('Memory Usage')).toBeInTheDocument()
    expect(screen.getByText('Disk Usage')).toBeInTheDocument()
    expect(screen.getByText('Incoming Network')).toBeInTheDocument()

    expect(getAlertRules).toHaveBeenCalledTimes(1)
  })

  it('shows an empty state when no rules exist', async () => {
    getAlertRules.mockResolvedValue([])

    renderPage()

    expect(
      await screen.findByText('No matching alert rules found.')
    ).toBeInTheDocument()
  })

  it('handles an API error and exits the loading state', async () => {
    const error = new Error('Network unavailable')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    getAlertRules.mockRejectedValue(error)

    renderPage()

    expect(
      await screen.findByText('No matching alert rules found.')
    ).toBeInTheDocument()

    expect(consoleError).toHaveBeenCalledWith(
      'Failed to fetch alert rules:',
      error
    )

    consoleError.mockRestore()
  })

  it('displays statistics calculated from all rules', async () => {
    renderPage()

    await screen.findByText('CPU Usage')

    expect(screen.getByText('Active Rules').parentElement)
      .toHaveTextContent('2')

    expect(screen.getByText('Disabled Rules').parentElement)
      .toHaveTextContent('2')

    expect(screen.getByText('Highest Threshold').parentElement)
      .toHaveTextContent('90%')

    expect(screen.getByText('Average Threshold').parentElement)
      .toHaveTextContent('72.5%')
  })

  it('searches rules by metric name', async () => {
    const { container } = renderPage()

    await screen.findByText('CPU Usage')

    fireEvent.change(screen.getByPlaceholderText('Search metrics...'), {
      target: { value: 'memory' },
    })

    expect(screen.getByText('Memory Usage')).toBeInTheDocument()
    expect(screen.queryByText('CPU Usage')).not.toBeInTheDocument()
    expect(getRuleNames(container)).toEqual(['Memory Usage'])
  })

  it('shows an empty result when the search has no matches', async () => {
    renderPage()

    await screen.findByText('CPU Usage')

    fireEvent.change(screen.getByPlaceholderText('Search metrics...'), {
      target: { value: 'nonexistent_metric' },
    })

    expect(
      screen.getByText('No matching alert rules found.')
    ).toBeInTheDocument()
  })

  it('filters enabled rules', async () => {
    const { container } = renderPage()

    await screen.findByText('CPU Usage')

    fireEvent.change(container.querySelectorAll('select')[0], {
      target: { value: 'enabled' },
    })

    expect(getRuleNames(container)).toEqual([
      'CPU Usage',
      'Disk Usage',
    ])
  })

  it('filters disabled rules', async () => {
    const { container } = renderPage()

    await screen.findByText('CPU Usage')

    fireEvent.change(container.querySelectorAll('select')[0], {
      target: { value: 'disabled' },
    })

    expect(getRuleNames(container)).toEqual([
      'Memory Usage',
      'Incoming Network',
    ])
  })

  it('filters rules by severity', async () => {
    const { container } = renderPage()

    await screen.findByText('CPU Usage')

    fireEvent.change(container.querySelectorAll('select')[1], {
      target: { value: 'critical' },
    })

    expect(getRuleNames(container)).toEqual([
      'CPU Usage',
      'Disk Usage',
    ])
  })

  it('combines status and severity filters', async () => {
    const { container } = renderPage()

    await screen.findByText('CPU Usage')

    fireEvent.change(container.querySelectorAll('select')[0], {
      target: { value: 'enabled' },
    })

    fireEvent.change(container.querySelectorAll('select')[1], {
      target: { value: 'critical' },
    })

    expect(getRuleNames(container)).toEqual([
      'CPU Usage',
      'Disk Usage',
    ])
  })

  it('sorts rules by metric name', async () => {
    const { container } = renderPage()

    await screen.findByText('CPU Usage')

    fireEvent.change(container.querySelectorAll('select')[2], {
      target: { value: 'metric' },
    })

    expect(getRuleNames(container)).toEqual([
      'CPU Usage',
      'Disk Usage',
      'Memory Usage',
      'Incoming Network',
    ])
  })

  it('sorts rules by highest threshold first', async () => {
    const { container } = renderPage()

    await screen.findByText('CPU Usage')

    fireEvent.change(container.querySelectorAll('select')[2], {
      target: { value: 'threshold-high' },
    })

    expect(getRuleNames(container)).toEqual([
      'Disk Usage',
      'CPU Usage',
      'Memory Usage',
      'Incoming Network',
    ])
  })

  it('sorts rules by lowest threshold first', async () => {
    const { container } = renderPage()

    await screen.findByText('CPU Usage')

    fireEvent.change(container.querySelectorAll('select')[2], {
      target: { value: 'threshold-low' },
    })

    expect(getRuleNames(container)).toEqual([
      'Incoming Network',
      'Memory Usage',
      'CPU Usage',
      'Disk Usage',
    ])
  })

  it('sorts rules by severity', async () => {
    const { container } = renderPage()

    await screen.findByText('CPU Usage')

    fireEvent.change(container.querySelectorAll('select')[2], {
      target: { value: 'severity' },
    })

    expect(getRuleNames(container)).toEqual([
      'CPU Usage',
      'Disk Usage',
      'Memory Usage',
      'Incoming Network',
    ])
  })

  it('updates the filtered summary when a severity filter is applied', async () => {
    const { container } = renderPage()

    await screen.findByText('CPU Usage')

    fireEvent.change(container.querySelectorAll('select')[1], {
      target: { value: 'critical' },
    })

    expect(screen.getByText('Showing').parentElement)
      .toHaveTextContent('2')

    expect(screen.getByText('Enabled', { selector: 'p.text-xs' }).parentElement)
      .toHaveTextContent('2')

    expect(screen.getByText('Critical', { selector: 'p.text-xs' }).parentElement)
      .toHaveTextContent('2')

    expect(screen.getByText('Warning', { selector: 'p.text-xs' }).parentElement)
      .toHaveTextContent('0')
  })

  it('expands and collapses rule details', async () => {
    renderPage()

    await screen.findByText('CPU Usage')

    fireEvent.click(screen.getAllByText('Show Details')[0])

    expect(screen.getByText('Metric Key')).toBeInTheDocument()
    expect(screen.getByText('cpu_usage')).toBeInTheDocument()
    expect(screen.getByText('Greater than')).toBeInTheDocument()
    expect(screen.getByText('#1')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Hide Details'))

    expect(screen.queryByText('Metric Key')).not.toBeInTheDocument()
  })

  it('disables an active rule through the API', async () => {
    updateAlertRule.mockImplementation(async (id, data) => ({
      ...rules.find(rule => rule.id === id),
      ...data,
    }))

    renderPage()

    await screen.findByText('CPU Usage')

    fireEvent.click(screen.getAllByRole('button', { name: 'Disable' })[0])

    await waitFor(() => {
      expect(updateAlertRule).toHaveBeenCalledWith(1, {
        threshold: 80,
        is_active: false,
      })
    })

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Enable' }))
        .toHaveLength(3)
    })
  })

  it('enables a disabled rule through the API', async () => {
    updateAlertRule.mockImplementation(async (id, data) => ({
      ...rules.find(rule => rule.id === id),
      ...data,
    }))

    renderPage()

    await screen.findByText('CPU Usage')

    fireEvent.click(screen.getAllByRole('button', { name: 'Enable' })[0])

    await waitFor(() => {
      expect(updateAlertRule).toHaveBeenCalledWith(2, {
        threshold: 70,
        is_active: true,
      })
    })
  })

  it('updates a threshold when its input loses focus', async () => {
    updateAlertRule.mockImplementation(async (id, data) => ({
      ...rules.find(rule => rule.id === id),
      ...data,
    }))

    renderPage()

    await screen.findByText('CPU Usage')

    const thresholdInput = screen.getAllByRole('spinbutton')[0]

    fireEvent.change(thresholdInput, {
      target: { value: '75' },
    })

    fireEvent.blur(thresholdInput)

    await waitFor(() => {
      expect(updateAlertRule).toHaveBeenCalledWith(1, {
        threshold: 75,
        is_active: true,
      })
    })
  })

  it('does not call the API for a non-numeric threshold', async () => {
    renderPage()

    await screen.findByText('CPU Usage')

    const thresholdInput = screen.getAllByRole('spinbutton')[0]

    fireEvent.change(thresholdInput, {
      target: { value: '' },
    })

    fireEvent.blur(thresholdInput)

    expect(updateAlertRule).not.toHaveBeenCalled()
  })

  it('keeps the page usable when a rule update fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    updateAlertRule.mockRejectedValue(new Error('Update failed'))

    renderPage()

    await screen.findByText('CPU Usage')

    fireEvent.click(screen.getAllByRole('button', { name: 'Disable' })[0])

    await waitFor(() => {
      expect(updateAlertRule).toHaveBeenCalled()
    })

    expect(screen.getByText('CPU Usage')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Disable' })).toHaveLength(2)

    consoleError.mockRestore()
  })
})
