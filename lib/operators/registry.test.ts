import { describe, it, expect, beforeEach } from 'vitest'
import { register, getOperator, allOperators, resolveDeps, clearRegistry } from './registry'
import type { Operator } from '../types'

const stub = (id: string, needs: string[] = []): Operator => ({
  id, name: id, wing: 'forensics', blurb: '', needs,
  costUnits: 1, estMs: 1, estOps: 1, touches: [],
  run: async () => ({ id, ops: 1, readings: {} }),
})

beforeEach(() => { clearRegistry() })

describe('registry', () => {
  it('registers and looks up', () => {
    register(stub('A'))
    expect(getOperator('A').id).toBe('A')
  })

  it('throws on an unknown id rather than returning undefined', () => {
    expect(() => getOperator('NOPE')).toThrow(/NOPE/)
  })

  it('refuses a duplicate id that is a different operator', () => {
    register(stub('A'))
    const impostor = { ...stub('A'), wing: 'esoteric' as const }
    expect(() => register(impostor)).toThrow(/already registered/)
  })

  it('refuses a duplicate id whose dependencies differ', () => {
    register(stub('A'))
    expect(() => register(stub('A', ['B']))).toThrow(/already registered/)
  })

  it('tolerates re-registering the identical operator, because that is a module re-evaluation', () => {
    register(stub('A'))
    expect(() => register(stub('A'))).not.toThrow()
    expect(allOperators()).toHaveLength(1)
  })

  it('lists everything registered', () => {
    register(stub('A')); register(stub('B'))
    expect(allOperators().map((o) => o.id).sort()).toEqual(['A', 'B'])
  })

  it('pulls in transitive dependencies', () => {
    register(stub('A')); register(stub('B', ['A'])); register(stub('C', ['B']))
    expect(resolveDeps(['C']).sort()).toEqual(['A', 'B', 'C'])
  })

  it('deduplicates a diamond', () => {
    register(stub('A')); register(stub('B', ['A'])); register(stub('C', ['A']))
    register(stub('D', ['B', 'C']))
    expect(resolveDeps(['D']).sort()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('rejects an operator whose dependency is not registered', () => {
    register(stub('B', ['MISSING']))
    expect(() => resolveDeps(['B'])).toThrow(/MISSING/)
  })
})
