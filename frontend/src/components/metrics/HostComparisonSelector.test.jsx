import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import HostComparisonSelector from './HostComparisonSelector'

const hosts = [
  { id: 1, name: 'production' },
  { id: 2, name: 'staging' },
  { id: 3, name: 'development' }
]

describe('HostComparisonSelector', () => {
  test('does not render when there are no comparable hosts', () => {
    const { container } = render(
      <HostComparisonSelector
        hosts={[hosts[0]]}
        primaryHostId={1}
        selectedHostIds={[]}
        onChange={vi.fn()}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })

  test('excludes the primary host from comparison options', () => {
    render(
      <HostComparisonSelector
        hosts={hosts}
        primaryHostId={1}
        selectedHostIds={[]}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByRole('group', { name: 'Compare with' }))
      .toBeInTheDocument()

    expect(screen.queryByLabelText('production')).not.toBeInTheDocument()
    expect(screen.getByLabelText('staging')).toBeInTheDocument()
    expect(screen.getByLabelText('development')).toBeInTheDocument()
  })

  test('checks the hosts already selected for comparison', () => {
    render(
      <HostComparisonSelector
        hosts={hosts}
        primaryHostId={1}
        selectedHostIds={[2]}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByLabelText('staging')).toBeChecked()
    expect(screen.getByLabelText('development')).not.toBeChecked()
  })

  test('adds a host when its checkbox is checked', () => {
    const onChange = vi.fn()

    render(
      <HostComparisonSelector
        hosts={hosts}
        primaryHostId={1}
        selectedHostIds={[2]}
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByLabelText('development'))

    expect(onChange).toHaveBeenCalledWith([2, 3])
  })

  test('removes a host when its checkbox is unchecked', () => {
    const onChange = vi.fn()

    render(
      <HostComparisonSelector
        hosts={hosts}
        primaryHostId={1}
        selectedHostIds={[2, 3]}
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByLabelText('staging'))

    expect(onChange).toHaveBeenCalledWith([3])
  })
})
