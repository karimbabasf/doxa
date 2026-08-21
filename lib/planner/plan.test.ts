import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Mock } from 'vitest'
import { composePlan } from './plan'
import { chatJson } from '../llm'
import { register, clearRegistry, allOperators } from '../operators/registry'
import type { Operator, Wing } from '../types'

/**
 * Nothing here reaches the model provider. There is no key in this environment and there
 * will not be one, so the model is a stub and every assertion is about what the
 * planner does with an answer, never about the answer itself.
 */
vi.mock('../llm', () => ({ chatJson: vi.fn(), embed: vi.fn() }))

const model = chatJson as unknown as Mock

type Spec = { id: string; wing: Wing; needs: string[]; cost: number; ms: number; ops: number }

const SPECS: Spec[] = [
  { id: 'TOKENIZE', wing: 'forensics', needs: [], cost: 1, ms: 10, ops: 100 },
  { id: 'HEDGE-7', wing: 'forensics', needs: ['TOKENIZE'], cost: 2, ms: 50, ops: 200 },
  { id: 'CLAIM-EX', wing: 'forensics', needs: ['TOKENIZE'], cost: 3, ms: 70, ops: 300 },
  { id: 'CORROBORATE', wing: 'field', needs: ['CLAIM-EX'], cost: 5, ms: 900, ops: 400 },
  { id: 'PRIOR-ART', wing: 'field', needs: ['CLAIM-EX'], cost: 4, ms: 800, ops: 250 },
  { id: 'GEMATRIA', wing: 'esoteric', needs: [], cost: 1, ms: 5, ops: 50 },
]

const build = (s: Spec): Operator => ({
  id: s.id,
  name: `${s.id} instrument`,
  wing: s.wing,
  blurb: `what ${s.id} measures`,
  needs: s.needs,
  costUnits: s.cost,
  estMs: s.ms,
  estOps: s.ops,
  touches: [],
  run: async () => ({ id: s.id, ops: s.ops, readings: {} }),
})

const pick = (id: string) => ({ id, rationale: `the text calls for ${id}` })
const ids = (order: { operators: { id: string }[] }) => order.operators.map(o => o.id)

const FACTUAL = 'The 2019 rent control law raised rents in San Francisco by 5 percent.'
const TASTE = 'Modern coffee shops feel joyless, and honestly nobody should have to shout to order.'

beforeEach(() => {
  clearRegistry()
  for (const s of SPECS) register(build(s))
  model.mockReset()
})

describe('composePlan', () => {
  it('shows the model every registered operator with its id, wing, blurb, needs, cost and time', async () => {
    model.mockResolvedValue({ picks: [pick('GEMATRIA')], notes: 'one instrument is enough' })
    await composePlan(TASTE, 'batch-1')

    const system: string = model.mock.calls[0][0].system
    for (const op of allOperators()) {
      expect(system).toContain(op.id)
      expect(system).toContain(op.wing)
      expect(system).toContain(op.blurb)
      expect(system).toContain(String(op.costUnits))
      expect(system).toContain(String(op.estMs))
      for (const need of op.needs) expect(system).toContain(need)
    }
  })

  it('computes the estimates from the registry and returns the operators in execution order', async () => {
    model.mockResolvedValue({
      picks: [pick('CORROBORATE'), pick('TOKENIZE'), pick('HEDGE-7'), pick('CLAIM-EX')],
      notes: 'the claim is checkable, so field work earns its bench time',
    })
    const order = await composePlan(FACTUAL, 'batch-2')

    expect(ids(order)).toEqual(['TOKENIZE', 'CLAIM-EX', 'HEDGE-7', 'CORROBORATE'])
    expect(order.estCostUnits).toBe(1 + 2 + 3 + 5)
    // Layers run concurrently, so time is the max within each layer, not the sum.
    expect(order.estMs).toBe(10 + 70 + 900)
    expect(order.estOps).toBe(100 + 200 + 300 + 400)
    expect(order.batchId).toBe('batch-2')
    expect(order.opinion).toBe(FACTUAL)
    expect(order.operators.every(o => o.enabled)).toBe(true)
    expect(order.plannerNotes).toContain('the claim is checkable')
    expect(Date.parse(order.createdAt)).not.toBeNaN()
  })

  it('adds a dependency the model forgot and says which pick pulled it in', async () => {
    model.mockResolvedValue({ picks: [pick('CORROBORATE')], notes: 'check it against the record' })
    const order = await composePlan(FACTUAL, 'batch-3')

    expect(ids(order)).toEqual(['TOKENIZE', 'CLAIM-EX', 'CORROBORATE'])
    const rationale = (id: string) => order.operators.find(o => o.id === id)?.rationale
    expect(rationale('CLAIM-EX')).toBe('pulled in as a dependency of CORROBORATE')
    expect(rationale('TOKENIZE')).toBe('pulled in as a dependency of CLAIM-EX')
    expect(rationale('CORROBORATE')).toBe('the text calls for CORROBORATE')
  })

  it('drops an operator the factory does not have and records the drop instead of throwing', async () => {
    model.mockResolvedValue({
      picks: [pick('GEMATRIA'), pick('ASTRAL-PROJECTION')],
      notes: 'numbers first',
    })
    const order = await composePlan(TASTE, 'batch-4')

    expect(ids(order)).toEqual(['GEMATRIA'])
    expect(order.plannerNotes).toContain('ASTRAL-PROJECTION')
    expect(order.plannerNotes).toContain('numbers first')
    expect(model).toHaveBeenCalledTimes(1)
  })

  it('retries once with the rejection reason and uses the corrected answer', async () => {
    model
      .mockResolvedValueOnce({ picks: [], notes: 'nothing worth running' })
      .mockResolvedValueOnce({ picks: [pick('GEMATRIA')], notes: 'one instrument after all' })
    const order = await composePlan(TASTE, 'batch-5')

    expect(model).toHaveBeenCalledTimes(2)
    expect(model.mock.calls[1][0].user).toContain('at least one')
    expect(ids(order)).toEqual(['GEMATRIA'])
  })

  it('falls back to the full library when the model fails validation twice', async () => {
    model.mockResolvedValue({ picks: [], notes: 'nothing worth running' })
    const order = await composePlan(TASTE, 'batch-6')

    expect(model).toHaveBeenCalledTimes(2)
    expect(ids(order)).toEqual(['GEMATRIA', 'TOKENIZE', 'CLAIM-EX', 'HEDGE-7', 'CORROBORATE', 'PRIOR-ART'])
    expect(order.estCostUnits).toBe(16)
    expect(order.plannerNotes).toMatch(/full library/i)
  })

  it('falls back rather than throwing when the model call itself fails twice', async () => {
    model.mockRejectedValue(new Error('Model API /chat/completions failed with 503: upstream'))
    const order = await composePlan(FACTUAL, 'batch-7')

    expect(ids(order)).toHaveLength(SPECS.length)
    expect(order.plannerNotes).toMatch(/full library/i)
  })

  it('sends the opinion and a reading of it, so two different texts get two different pipelines', async () => {
    // Stands in for a model that actually reads the brief: field work is chosen
    // from the signal line, not from a fixed favourite.
    model.mockImplementation(async (opts: { user: string }) => {
      const checkable = /checkable detail: yes/.test(opts.user)
      return {
        picks: [pick(checkable ? 'CORROBORATE' : 'PRIOR-ART'), pick('HEDGE-7')],
        notes: checkable ? 'verify it' : 'find who said it first',
      }
    })

    const factual = await composePlan(FACTUAL, 'batch-8')
    const taste = await composePlan(TASTE, 'batch-9')

    expect(model.mock.calls[0][0].user).toContain(FACTUAL)
    expect(model.mock.calls[1][0].user).toContain(TASTE)
    expect(model.mock.calls[0][0].user).not.toBe(model.mock.calls[1][0].user)
    expect(ids(factual)).toContain('CORROBORATE')
    expect(ids(taste)).toContain('PRIOR-ART')
    expect(ids(factual)).not.toEqual(ids(taste))
    expect(factual.estCostUnits).not.toBe(taste.estCostUnits)
  })

  it('falls back when the model returns a shape the assembler cannot use', async () => {
    model.mockResolvedValue({ picks: [null], notes: 'malformed on purpose' })
    const order = await composePlan(TASTE, 'batch-10')

    expect(model).toHaveBeenCalledTimes(2)
    expect(ids(order)).toHaveLength(SPECS.length)
    expect(order.plannerNotes).toMatch(/full library/i)
    expect(order.plannerNotes).toMatch(/could not be assembled/)
  })
})
