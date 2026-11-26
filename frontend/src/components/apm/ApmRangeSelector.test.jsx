import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ApmRangeSelector from './ApmRangeSelector'

describe('ApmRangeSelector', () => {
  test('marks the selected range and reports a new choice', () => {
    const onChange = vi.fn()

    render(<ApmRangeSelector value="1h" onChange={onChange} />)

    expect(screen.getByRole('button', { name: '1h' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '6h' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: '24h' }))

    expect(onChange).toHaveBeenCalledWith('24h')
  })
})