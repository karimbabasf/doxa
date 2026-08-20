import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearRegistry, register } from '@/lib/operators/registry'
import { layerOps } from '@/lib/planner/validate'
import type { Operator, WorkOrder } from '@/lib/types'

/**
 * The route is the only place an opinion is cleaned, so the cleaning is tested here
 * and nowhere else. The planner itself is mocked: it makes a network call, and what
 * this route owes the caller is intake rules, a batch id, two database rows and the
 * planner's order passed through untouched.
 */

const { composePlan } = vi.hoisted(() => ({ composePlan: vi.fn() }))
vi.mock('@/lib/planner/plan', () => ({ composePlan }))
// The real library registers twenty one operators at import time and would
// collide with the fixtures below, so the barrel is stubbed out here.
vi.mock('@/lib/operators', () => ({}))


const dir = mkdtempSync(join(tmpdir(), 'doxa-plan-'))
process.env.DOXA_DB_PATH = join(dir, 'plan.db')
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const op = (id: string, needs: string[]): Operator => ({
  id,
  name: `${id} instrument`,
  wing: 'forensics',
  blurb: 'A fixture.',
  needs,
  costUnits: 1,
  estMs: 10,
  estOps: 5,
  touches: [],
  async run() {
    return { id, ops: 1, readings: {} }
  },
})

/** A shape with a real dependency chain, so "execution order" means something. */
const FIXTURES = [
  op('TOKENIZE', []),
  op('HEDGE-7', ['TOKENIZE']),
  op('CLAIM-EX', ['TOKENIZE']),
  op('STANCE', ['CLAIM-EX']),
]

function orderFor(opinion: string, batchId: string): WorkOrder {
  const flat = layerOps(FIXTURES).flat()
  return {
    batchId,
    opinion,
    operators: flat.map(o => ({ id: o.id, rationale: `picked because of ${o.id}`, enabled: true })),
    estCostUnits: 4,
    estMs: 30,
    estOps: 20,
    plannerNotes: 'A fixture plan.',
    createdAt: '2026-08-21T00:00:00.000Z',
  }
}

async function post(body: unknown): Promise<Response> {
  const { POST } = await import('./route')
  return POST(new Request('http://localhost/api/plan', { method: 'POST', body: JSON.stringify(body) }))
}

beforeEach(() => {
  clearRegistry()
  for (const fixture of FIXTURES) register(fixture)
  composePlan.mockReset()
  composePlan.mockImplementation(async (opinion: string, batchId: string) => orderFor(opinion, batchId))
})

describe('POST /api/plan', () => {
  it('refuses an opinion under three words and says how short it is', async () => {
    const res = await post({ opinion: 'too short' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('3 words')
    expect(body.error).toContain('2')
    expect(composePlan).not.toHaveBeenCalled()
  })

  it('refuses an opinion over 500 characters', async () => {
    const res = await post({ opinion: 'a b '.repeat(200) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('500 characters')
    expect(composePlan).not.toHaveBeenCalled()
  })

  it('refuses a body with no opinion string', async () => {
    const res = await post({ nope: 1 })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('opinion')
  })

  it('normalises smart quotes and whitespace before the planner sees the text', async () => {
    const res = await post({ opinion: '  The “best” tool   isn’t\nthe\tloudest  one  ' })
    expect(res.status).toBe(200)
    const order = (await res.json()) as WorkOrder
    expect(order.opinion).toBe('The "best" tool isn\'t the loudest one')
    expect(composePlan).toHaveBeenCalledWith(order.opinion, order.batchId)
  })

  it('returns the planner order with its operators in execution order', async () => {
    const res = await post({ opinion: 'Design reviews are theatre for people who fear shipping.' })
    expect(res.status).toBe(200)
    const order = (await res.json()) as WorkOrder
    const ids = order.operators.map(e => e.id)

    expect(ids).toEqual(['TOKENIZE', 'CLAIM-EX', 'HEDGE-7', 'STANCE'])
    for (const entry of order.operators) {
      for (const need of FIXTURES.find(f => f.id === entry.id)!.needs) {
        expect(ids.indexOf(need)).toBeLessThan(ids.indexOf(entry.id))
      }
    }
    expect(order.operators.every(e => e.rationale.length > 0)).toBe(true)
  })

  it('writes the batch and the work order to the database', async () => {
    const opinion = 'Remote work made meetings the only visible unit of effort.'
    const res = await post({ opinion })
    const order = (await res.json()) as WorkOrder

    const { openDb, getBatch, getWorkOrder } = await import('@/lib/db')
    const db = openDb(process.env.DOXA_DB_PATH as string)
    const batch = getBatch(db, order.batchId)
    const stored = getWorkOrder(db, order.batchId)
    db.close()

    expect(batch?.opinion).toBe(opinion)
    expect(stored?.order.operators.map(e => e.id)).toEqual(order.operators.map(e => e.id))
    expect(stored?.signedAt).toBeNull()
  })

  it('gives every batch its own id', async () => {
    const one = (await (await post({ opinion: 'One take about tooling.' })).json()) as WorkOrder
    const two = (await (await post({ opinion: 'Another take about tooling.' })).json()) as WorkOrder
    expect(one.batchId).not.toBe(two.batchId)
  })
})
