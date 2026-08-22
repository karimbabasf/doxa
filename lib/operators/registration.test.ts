import { describe, it, expect } from 'vitest'
import { ALL_OPERATORS, allOperators, resolveDeps } from './index'

describe('the registered factory', () => {
  // Asserted against the fixed catalogue rather than the registry's size, because
  // DEMO-SHOP registers itself only under DOXA_DEMO_SHOP=1. A size check here would
  // pass or fail on whether the demo flag happened to be exported in the shell.
  it('registers twenty one operators across four wings', () => {
    expect(ALL_OPERATORS).toHaveLength(21)
    const registered = new Set(allOperators().map((o) => o.id))
    for (const op of ALL_OPERATORS) expect(registered.has(op.id)).toBe(true)
    const wings = new Set(ALL_OPERATORS.map((o) => o.wing))
    expect([...wings].sort()).toEqual(['esoteric', 'field', 'forensics', 'semantics'])
  })

  it('gives every operator a unique id', () => {
    const ids = ALL_OPERATORS.map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('resolves every declared dependency to a registered operator', () => {
    expect(() => resolveDeps(ALL_OPERATORS.map((o) => o.id))).not.toThrow()
  })

  it('declares only touches that exist as render paths', async () => {
    const { ALL_RENDER_PATHS } = await import('../types')
    for (const op of ALL_OPERATORS) {
      for (const p of op.touches) expect(ALL_RENDER_PATHS).toContain(p)
    }
  })

  it('covers every render path with at least one contributor, or the foundry throws', async () => {
    const { ALL_RENDER_PATHS } = await import('../types')
    const claimed = new Set(ALL_OPERATORS.flatMap((o) => o.touches))
    const unclaimed = ALL_RENDER_PATHS.filter((p) => !claimed.has(p))
    expect(unclaimed).toEqual([])
  })
})
