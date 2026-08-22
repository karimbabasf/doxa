import { describe, expect, it } from 'vitest'
import { enabledIds, estimateMs, resolve, resolveList, type Switchable } from './planSwitches'

const op = (id: string, needs: string[] = []): Switchable => ({ id, needs })

describe('resolve', () => {
  it('runs everything when nothing is switched off', () => {
    const state = resolve([[op('A')], [op('B', ['A'])]], new Set())
    expect(state.get('A')?.on).toBe(true)
    expect(state.get('B')?.on).toBe(true)
  })

  it('switches off what reads the result of a refused instrument', () => {
    const state = resolve([[op('A')], [op('B', ['A'])], [op('C', ['B'])]], new Set(['A']))
    expect(state.get('B')).toEqual({ on: false, blockedBy: ['A'] })
    expect(state.get('C')).toEqual({ on: false, blockedBy: ['B'] })
  })

  it('separates a refusal from a block, so the screen can say which it is', () => {
    const state = resolve([[op('A')], [op('B', ['A'])]], new Set(['A']))
    expect(state.get('A')?.blockedBy).toEqual([])
    expect(state.get('B')?.blockedBy).toEqual(['A'])
  })

  it('brings dependents back when the dependency comes back', () => {
    const layers = [[op('A')], [op('B', ['A'])]]
    expect(resolve(layers, new Set(['A'])).get('B')?.on).toBe(false)
    expect(resolve(layers, new Set()).get('B')?.on).toBe(true)
  })

  it('leaves a hand refusal off when its dependency comes back', () => {
    const state = resolve([[op('A')], [op('B', ['A'])]], new Set(['B']))
    expect(state.get('A')?.on).toBe(true)
    expect(state.get('B')?.on).toBe(false)
  })

  it('counts a need only once when it is listed twice', () => {
    const state = resolve([[op('A')], [op('B', ['A', 'A'])]], new Set(['A']))
    expect(state.get('B')?.blockedBy).toEqual(['A'])
  })
})

describe('resolveList', () => {
  it('layers a flat list through the executor sort', () => {
    const state = resolveList([op('C', ['B']), op('A'), op('B', ['A'])], new Set(['A']))
    expect(state.get('C')?.on).toBe(false)
  })

  it('draws rather than throws on an order the planner made cyclic', () => {
    const state = resolveList([op('A', ['B']), op('B', ['A'])], new Set())
    expect(state.get('A')?.on).toBe(false)
    expect(state.get('B')?.on).toBe(false)
  })
})

describe('enabledIds', () => {
  it('keeps the planner order rather than the layer order', () => {
    const operators = [op('C', ['B']), op('A'), op('B', ['A'])]
    expect(enabledIds(operators, resolveList(operators, new Set()))).toEqual(['C', 'A', 'B'])
  })

  it('drops everything a refusal took with it', () => {
    const operators = [op('A'), op('B', ['A']), op('D')]
    expect(enabledIds(operators, resolveList(operators, new Set(['A'])))).toEqual(['D'])
  })
})

describe('estimateMs', () => {
  const timed = (id: string, estMs: number, needs: string[] = []) => ({ id, needs, estMs })

  it('adds the slowest instrument in each layer, not every instrument', () => {
    const ops = [timed('A', 100), timed('B', 400), timed('C', 50, ['A', 'B'])]
    expect(estimateMs(ops, resolveList(ops, new Set()))).toBe(450)
  })

  it('falls when the slow instrument is switched off', () => {
    const ops = [timed('A', 100), timed('WEB', 120_000)]
    expect(estimateMs(ops, resolveList(ops, new Set(['WEB'])))).toBe(100)
  })

  it('is zero when everything is switched off', () => {
    const ops = [timed('A', 100)]
    expect(estimateMs(ops, resolveList(ops, new Set(['A'])))).toBe(0)
  })
})
