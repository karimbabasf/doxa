import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearRegistry, register } from '@/lib/operators/registry'
import type { Operator, WorkOrder } from '@/lib/types'

/**
 * Signing is the moment a plan becomes the plan of record, so this route refuses
 * anything the factory could not execute rather than letting the floor find out.
 * The reasons come from `validateWorkOrder`, which already writes them for a human.
 */

// The real library registers twenty one operators at import time and would
// collide with the fixtures below, so the barrel is stubbed out here.
vi.mock('@/lib/operators', () => ({}))

const dir = mkdtempSync(join(tmpdir(), 'doxa-sign-'))
process.env.DOXA_DB_PATH = join(dir, 'sign.db')
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

const FIXTURES = [
  op('TOKENIZE', []),
  op('HEDGE-7', ['TOKENIZE']),
  op('CLAIM-EX', ['TOKENIZE']),
  op('STANCE', ['CLAIM-EX']),
]

let seq = 0

async function seedOrder(): Promise<WorkOrder> {
  const order: WorkOrder = {
    batchId: `B-SIGN-${seq++}`,
    opinion: 'Design reviews are theatre for people who fear shipping.',
    operators: ['TOKENIZE', 'CLAIM-EX', 'HEDGE-7', 'STANCE'].map(id => ({
      id,
      rationale: `picked because of ${id}`,
      enabled: true,
    })),
    estCostUnits: 4,
    estMs: 30,
    estOps: 20,
    plannerNotes: 'A fixture plan.',
    createdAt: '2026-08-21T00:00:00.000Z',
  }
  const { openDb, insertWorkOrder } = await import('@/lib/db')
  const db = openDb(process.env.DOXA_DB_PATH as string)
  insertWorkOrder(db, order)
  db.close()
  return order
}

async function readBack(batchId: string) {
  const { openDb, getWorkOrder } = await import('@/lib/db')
  const db = openDb(process.env.DOXA_DB_PATH as string)
  const row = getWorkOrder(db, batchId)
  db.close()
  return row
}

async function post(body: unknown): Promise<Response> {
  const { POST } = await import('./route')
  return POST(
    new Request('http://localhost/api/plan/sign', { method: 'POST', body: JSON.stringify(body) }),
  )
}

beforeEach(() => {
  clearRegistry()
  for (const fixture of FIXTURES) register(fixture)
})

describe('POST /api/plan/sign', () => {
  it('stamps the order and stores the enabled set the human chose', async () => {
    const order = await seedOrder()
    const res = await post({ batchId: order.batchId, enabledIds: ['TOKENIZE', 'HEDGE-7'] })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })

    const stored = await readBack(order.batchId)
    expect(stored?.signedAt).toBeTruthy()
    expect(stored?.order.operators.filter(e => e.enabled).map(e => e.id)).toEqual([
      'TOKENIZE',
      'HEDGE-7',
    ])
    // Switched off operators stay on the order. The record has to show what was refused.
    expect(stored?.order.operators.map(e => e.id)).toEqual(order.operators.map(e => e.id))
  })

  it('refuses an enabled operator whose dependency was switched off', async () => {
    const order = await seedOrder()
    const res = await post({ batchId: order.batchId, enabledIds: ['STANCE'] })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('CLAIM-EX')
    expect((await readBack(order.batchId))?.signedAt).toBeNull()
  })

  it('refuses an empty enabled set', async () => {
    const order = await seedOrder()
    const res = await post({ batchId: order.batchId, enabledIds: [] })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('at least one')
    expect((await readBack(order.batchId))?.signedAt).toBeNull()
  })

  it('refuses an id that is not on the work order', async () => {
    const order = await seedOrder()
    const res = await post({ batchId: order.batchId, enabledIds: ['TOKENIZE', 'GEMATRIA'] })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('GEMATRIA')
    expect((await readBack(order.batchId))?.signedAt).toBeNull()
  })

  it('reports an unknown batch as missing', async () => {
    const res = await post({ batchId: 'B-NOT-A-BATCH', enabledIds: ['TOKENIZE'] })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toContain('B-NOT-A-BATCH')
  })

  it('refuses a body without a batch id', async () => {
    const res = await post({ enabledIds: ['TOKENIZE'] })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('batchId')
  })
})
