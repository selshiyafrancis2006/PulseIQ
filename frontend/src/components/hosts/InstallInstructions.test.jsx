import { describe, expect, test } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import InstallInstructions from './InstallInstructions'

describe('InstallInstructions', () => {
  test('shows the agent install command by default', () => {
    render(<InstallInstructions apiKey="key-123" />)

    expect(screen.getByText(/node collector\.js/)).toBeInTheDocument()
    expect(screen.getByText(/API_KEY=key-123/)).toBeInTheDocument()
  })

  test('the APM tab shows the Express middleware snippet with the host key', () => {
    render(<InstallInstructions apiKey="key-123" />)

    fireEvent.click(screen.getByRole('button', { name: 'APM (Express)' }))

    expect(screen.getByText(/require\('\.\/apm-middleware'\)/)).toBeInTheDocument()
    expect(screen.getByText(/apiKey: 'key-123'/)).toBeInTheDocument()
    expect(screen.getByText(/npm install axios/)).toBeInTheDocument()
    expect(screen.queryByText(/node collector\.js/)).not.toBeInTheDocument()
    expect(screen.getByText(/PULSEIQ_API_KEY/)).toBeInTheDocument()
  })

  test('switching back to a platform tab hides the APM snippet', () => {
    render(<InstallInstructions apiKey="key-123" />)

    fireEvent.click(screen.getByRole('button', { name: 'APM (Express)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Docker' }))

    expect(screen.queryByText(/apm-middleware/)).not.toBeInTheDocument()
    expect(screen.getByText(/docker build/)).toBeInTheDocument()
  })
})
