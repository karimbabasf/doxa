// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import HomePage from './page'

/**
 * The roll itself is CSS and not worth asserting on. What matters is that a line in it
 * is a real control: clicking one loads the field, because a suggestion that only looks
 * clickable is the failure mode this screen is most likely to have.
 */

afterEach(cleanup)

describe('the front door', () => {
  it('puts a clicked sample in the field', () => {
    render(<HomePage />)
    const field = screen.getByLabelText('THE OPINION') as HTMLTextAreaElement
    expect(field.value).toBe('')

    const sample = screen.getAllByRole('button', { name: /design reviews are theatre/i })[0]
    fireEvent.click(sample)

    expect(field.value).toMatch(/^Design reviews are theatre/)
  })

  it('holds the compose button shut until the text clears intake', () => {
    render(<HomePage />)
    const compose = screen.getByRole('button', { name: /COMPOSE THE WORK ORDER/ }) as HTMLButtonElement
    expect(compose.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('THE OPINION'), {
      target: { value: 'two words' },
    })
    expect(compose.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('THE OPINION'), {
      target: { value: 'now it is three words at least' },
    })
    expect(compose.disabled).toBe(false)
  })

  it('carries a second hidden copy of the list so the loop has no seam', () => {
    const { container } = render(<HomePage />)
    const visible = container.querySelectorAll('.suggest-track > .suggest-row')
    const duplicated = container.querySelectorAll('.suggest-dup > .suggest-row')
    expect(visible.length).toBeGreaterThan(3)
    expect(duplicated.length).toBe(visible.length)
    expect(container.querySelector('.suggest-dup')?.getAttribute('aria-hidden')).toBe('true')
  })
})

