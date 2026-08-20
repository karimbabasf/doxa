import { describe, it, expect } from 'vitest'
import { layer } from './topo'
import type { Operator } from '../types'

const stub = (id: string, needs: string[] = []): Operator => ({
  id, name: id, wing: 'forensics', blurb: '', needs, costUnits: 1, estMs: 1, estOps: 1, touches: [],
  run: async () => ({ id, ops: 1, readings: {} }),
})

describe('layer', () => {
  it('puts independent operators in one layer', () => {
    const l = layer([stub('A'), stub('B')])
    expect(l.length).toBe(1)
    expect(l[0].map(o => o.id).sort()).toEqual(['A', 'B'])
  })

  it('puts a dependent operator in a later layer', () => {
    const l = layer([stub('B', ['A']), stub('A')])
    expect(l.map(g => g.map(o => o.id))).toEqual([['A'], ['B']])
  })

  it('handles a diamond', () => {
    const l = layer([stub('D', ['B', 'C']), stub('B', ['A']), stub('C', ['A']), stub('A')])
    expect(l[0].map(o => o.id)).toEqual(['A'])
    expect(l[1].map(o => o.id).sort()).toEqual(['B', 'C'])
    expect(l[2].map(o => o.id)).toEqual(['D'])
  })

  it('throws naming the members of a cycle', () => {
    expect(() => layer([stub('A', ['B']), stub('B', ['A'])])).toThrow(/cycle/i)
  })

  it('ignores a need that is not in the given set', () => {
    // The planner may disable an operator. Its dependents were already dropped
    // by the gate, so a dangling need here is not an error.
    expect(() => layer([stub('B', ['NOT_INCLUDED'])])).not.toThrow()
  })

  it('names an operator that needs itself as a cycle', () => {
    expect(() => layer([stub('A', ['A'])])).toThrow(/cycle/i)
  })

  it('rejects the same id twice, because it would run and be counted twice', () => {
    expect(() => layer([stub('A'), stub('A')])).toThrow(/twice/i)
  })

  it('returns no layers for an empty set', () => {
    expect(layer([])).toEqual([])
  })

  it('orders each layer by id, so a run is reproducible', () => {
    const l = layer([stub('C'), stub('A'), stub('B')])
    expect(l[0].map(o => o.id)).toEqual(['A', 'B', 'C'])
  })
})
