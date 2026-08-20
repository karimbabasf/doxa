// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import WorkOrderDag, { type GateOperator } from './WorkOrderDag'

/**
 * The gate is where a person takes responsibility for a plan, so the thing under test
 * is not the drawing. It is whether the screen tells the truth about what a switch
 * does before the switch is thrown.
 */

afterEach(cleanup)

const op = (
  id: string,
  needs: string[],
  extra: Partial<GateOperator> = {},
): GateOperator => ({
  id,
  name: `${id} instrument`,
  wing: 'forensics',
  blurb: 'A fixture.',
  needs,
  costUnits: 1,
  estMs: 10,
  estOps: 5,
  touches: [],
  rationale: `chosen because of ${id}`,
  enabled: true,
  ...extra,
})

const OPERATORS: GateOperator[] = [
  op('TOKENIZE', [], { name: 'Token and sentence census', estMs: 5, estOps: 40 }),
  op('CLAIM-EX', ['TOKENIZE'], {
    wing: 'semantics',
    costUnits: 3,
    estMs: 900,
    estOps: 12,
    rationale: 'the text names two companies and a year, so there is something to check',
  }),
  op('HEDGE-7', ['TOKENIZE'], { estMs: 12, estOps: 30 }),
  op('STANCE', ['CLAIM-EX'], { wing: 'semantics', costUnits: 3, estMs: 800, estOps: 9 }),
]

function draw(props: Partial<React.ComponentProps<typeof WorkOrderDag>> = {}) {
  return render(
    <WorkOrderDag batchId="B-TEST-1" operators={OPERATORS} onSign={vi.fn()} {...props} />,
  )
}

const card = (id: string) => document.querySelector(`[data-op-id="${id}"]`) as HTMLElement
const toggle = (id: string) => screen.getByRole('switch', { name: new RegExp(id) })
const totals = () => ({
  cost: screen.getByTestId('total-cost').textContent,
  ms: screen.getByTestId('total-ms').textContent,
  ops: screen.getByTestId('total-ops').textContent,
})

describe('WorkOrderDag', () => {
  it('renders every operator with its id, name and the planner rationale', () => {
    draw()
    for (const o of OPERATORS) {
      expect(card(o.id)).toBeTruthy()
      expect(card(o.id).textContent).toContain(o.id)
      expect(card(o.id).textContent).toContain(o.name)
      expect(card(o.id).textContent).toContain(o.rationale)
    }
  })

  it('puts operators that run together in the same column, in dependency order', () => {
    const { container } = draw()
    const columns = [...container.querySelectorAll('[data-layer]')]
    expect(columns.length).toBe(3)

    const ids = columns.map(col => [...col.querySelectorAll('[data-op-id]')].map(c => c.getAttribute('data-op-id')))
    expect(ids[0]).toEqual(['TOKENIZE'])
    expect(ids[1]).toEqual(['CLAIM-EX', 'HEDGE-7'])
    expect(ids[2]).toEqual(['STANCE'])
  })

  it('names the dependents a switch would take with it before it is thrown', () => {
    draw()
    fireEvent.mouseEnter(toggle('TOKENIZE'))
    const warning = screen.getByTestId('consequence').textContent as string
    expect(warning).toContain('CLAIM-EX')
    expect(warning).toContain('HEDGE-7')
    expect(warning).toContain('STANCE')
    // Nothing has changed yet. It is a warning, not a result.
    expect(card('HEDGE-7').getAttribute('data-state')).toBe('on')
  })

  it('says so plainly when a switch takes nothing with it', () => {
    draw()
    fireEvent.mouseEnter(toggle('STANCE'))
    expect(screen.getByTestId('consequence').textContent).toMatch(/nothing else/i)
  })

  it('disables the dependents when an operator is switched off and gives the reason', () => {
    draw()
    fireEvent.click(toggle('CLAIM-EX'))

    expect(card('CLAIM-EX').getAttribute('data-state')).toBe('off')
    expect(card('STANCE').getAttribute('data-state')).toBe('blocked')
    expect(card('STANCE').textContent).toContain('CLAIM-EX')
    expect(card('HEDGE-7').getAttribute('data-state')).toBe('on')
    expect(screen.getByTestId('last-action').textContent).toContain('STANCE')
  })

  it('brings back only what a switch took down, not what a person switched off', () => {
    draw()
    fireEvent.click(toggle('STANCE'))
    fireEvent.click(toggle('TOKENIZE'))
    expect(card('CLAIM-EX').getAttribute('data-state')).toBe('blocked')

    fireEvent.click(toggle('TOKENIZE'))
    expect(card('CLAIM-EX').getAttribute('data-state')).toBe('on')
    expect(card('STANCE').getAttribute('data-state')).toBe('off')
  })

  it('shows the declared cost, time and operation estimates and recounts them on a toggle', () => {
    draw()
    // Layers run together, so the time estimate takes the slowest member of each.
    expect(totals()).toEqual({ cost: '8', ms: '1705', ops: '91' })

    fireEvent.click(toggle('CLAIM-EX'))
    expect(totals()).toEqual({ cost: '2', ms: '17', ops: '70' })
  })

  it('refuses to sign an empty work order and signs the enabled set in execution order', () => {
    const onSign = vi.fn()
    draw({ onSign })
    const sign = screen.getByRole('button', { name: /sign/i }) as HTMLButtonElement

    fireEvent.click(toggle('TOKENIZE'))
    expect(sign.disabled).toBe(true)
    fireEvent.click(sign)
    expect(onSign).not.toHaveBeenCalled()

    fireEvent.click(toggle('TOKENIZE'))
    fireEvent.click(toggle('CLAIM-EX'))
    fireEvent.click(sign)
    expect(onSign).toHaveBeenCalledWith(['TOKENIZE', 'HEDGE-7'])
  })

  it('locks the toggles once the order carries a signature', () => {
    draw({ signedAt: '2026-08-21T09:00:00.000Z' })
    expect((toggle('TOKENIZE') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('signature').textContent).toContain('2026')
  })
})
