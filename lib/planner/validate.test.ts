import { describe, it, expect, beforeEach } from 'vitest'
import { validateWorkOrder, layerOps } from './validate'
import { register, clearRegistry, getOperator } from '../operators/registry'
import type { Operator, WorkOrder } from '../types'

/**
 * Fixture operators, not the real library. `lib/operators/index.ts` is written
 * between waves, so a test that imported it would fail for a reason that has
 * nothing to do with validation.
 */
const stub = (id: string, needs: string[] = []): Operator => ({
  id, name: id, wing: 'forensics', blurb: `${id} blurb`, needs,
  costUnits: 1, estMs: 1, estOps: 1, touches: [],
  run: async () => ({ id, ops: 1, readings: {} }),
})

const order = (ops: { id: string; enabled?: boolean }[]): WorkOrder => ({
  batchId: 'batch-1',
  opinion: 'coffee shops are too loud',
  operators: ops.map(o => ({ id: o.id, rationale: 'because the text asks for it', enabled: o.enabled ?? true })),
  estCostUnits: 0,
  estMs: 0,
  estOps: 0,
  plannerNotes: 'notes',
  createdAt: '2026-08-20T00:00:00.000Z',
})

beforeEach(() => {
  clearRegistry()
  register(stub('TOKENIZE'))
  register(stub('HEDGE-7', ['TOKENIZE']))
  register(stub('CLAIM-EX', ['TOKENIZE']))
  register(stub('CORROBORATE', ['CLAIM-EX']))
  register(stub('LOOP-A', ['LOOP-B']))
  register(stub('LOOP-B', ['LOOP-A']))
})

describe('validateWorkOrder', () => {
  it('rejects an unregistered operator id and names it', () => {
    const res = validateWorkOrder(order([{ id: 'TOKENIZE' }, { id: 'ASTRAL-PROJECTION' }]))
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.reason).toMatch(/ASTRAL-PROJECTION/)
  })

  it('rejects the same operator listed twice, since it would run and be counted twice', () => {
    const res = validateWorkOrder(order([{ id: 'TOKENIZE' }, { id: 'TOKENIZE' }]))
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.reason).toMatch(/TOKENIZE/)
  })

  it('rejects an enabled operator whose dependency is disabled, naming both', () => {
    const res = validateWorkOrder(order([{ id: 'TOKENIZE', enabled: false }, { id: 'HEDGE-7' }]))
    expect(res.ok).toBe(false)
    const reason = res.ok === false ? res.reason : ''
    expect(reason).toMatch(/HEDGE-7/)
    expect(reason).toMatch(/TOKENIZE/)
  })

  it('rejects an enabled operator whose dependency is absent from the order, naming both', () => {
    const res = validateWorkOrder(order([{ id: 'CORROBORATE' }]))
    expect(res.ok).toBe(false)
    const reason = res.ok === false ? res.reason : ''
    expect(reason).toMatch(/CORROBORATE/)
    expect(reason).toMatch(/CLAIM-EX/)
  })

  it('rejects a cycle in the enabled set with a reason containing "cycle"', () => {
    const res = validateWorkOrder(order([{ id: 'LOOP-A' }, { id: 'LOOP-B' }]))
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.reason).toMatch(/cycle/i)
  })

  it('rejects an empty enabled set with a reason containing "at least one"', () => {
    const res = validateWorkOrder(order([{ id: 'TOKENIZE', enabled: false }]))
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.reason).toMatch(/at least one/i)
  })

  it('ignores disabled operators when checking dependencies', () => {
    const res = validateWorkOrder(order([
      { id: 'TOKENIZE' },
      { id: 'HEDGE-7' },
      { id: 'CORROBORATE', enabled: false },
    ]))
    expect(res).toEqual({ ok: true })
  })

  it('accepts a valid order', () => {
    const res = validateWorkOrder(order([
      { id: 'TOKENIZE' }, { id: 'CLAIM-EX' }, { id: 'CORROBORATE' },
    ]))
    expect(res).toEqual({ ok: true })
  })
})

describe('layerOps', () => {
  it('groups independent operators into one layer and dependents into later ones', () => {
    const ops = ['TOKENIZE', 'HEDGE-7', 'CLAIM-EX', 'CORROBORATE'].map(getOperator)
    expect(layerOps(ops).map(l => l.map(o => o.id))).toEqual([
      ['TOKENIZE'], ['CLAIM-EX', 'HEDGE-7'], ['CORROBORATE'],
    ])
  })

  it('throws naming the operators stuck in a cycle', () => {
    expect(() => layerOps(['LOOP-A', 'LOOP-B'].map(getOperator))).toThrow(/cycle/i)
  })
})
