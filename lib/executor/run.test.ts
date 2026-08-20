import { describe, it, expect, vi } from 'vitest'
import { executeRun, type FloorEvent } from './run'
import type { Operator, Ctx } from '../types'

const op = (id: string, needs: string[], impl?: () => Promise<unknown>): Operator => ({
  id, name: id, wing: 'forensics', blurb: '', needs, costUnits: 1, estMs: 1, estOps: 1, touches: [],
  run: async () => { if (impl) await impl(); return { id, ops: 7, readings: { ok: 1 } } },
})

const ctx = (): Ctx => ({ opinion: 'x y z', batchId: 'b', results: new Map() })
const opts = (over = {}) => ({ concurrency: 4, timeoutMs: 1000, onEvent: () => {}, ...over })

describe('executeRun', () => {
  it('sums real operation counts', async () => {
    const r = await executeRun([op('A', []), op('B', [])], ctx(), opts())
    expect(r.totalOps).toBe(14)
  })

  it('makes a dependency result visible to its dependent', async () => {
    const seen: unknown[] = []
    const B: Operator = { ...op('B', ['A']), run: async (c) => {
      seen.push(c.results.get('A')?.readings.ok)
      return { id: 'B', ops: 1, readings: {} }
    } }
    await executeRun([op('A', []), B], ctx(), opts())
    expect(seen).toEqual([1])
  })

  it('runs independent operators concurrently', async () => {
    let live = 0, peak = 0
    const slow = () => new Promise<void>(res => {
      live++; peak = Math.max(peak, live)
      setTimeout(() => { live--; res() }, 30)
    })
    await executeRun([op('A', [], slow), op('B', [], slow), op('C', [], slow)], ctx(), opts())
    expect(peak).toBeGreaterThan(1)
  })

  it('respects the concurrency cap', async () => {
    let live = 0, peak = 0
    const slow = () => new Promise<void>(res => {
      live++; peak = Math.max(peak, live)
      setTimeout(() => { live--; res() }, 20)
    })
    const ops = ['A', 'B', 'C', 'D', 'E'].map(id => op(id, [], slow))
    await executeRun(ops, ctx(), opts({ concurrency: 2 }))
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('isolates a failure and skips only its dependents', async () => {
    const boom = op('A', [], async () => { throw new Error('nope') })
    const r = await executeRun([boom, op('B', ['A']), op('C', [])], ctx(), opts())
    expect(r.failed).toEqual(['A'])
    expect(r.skipped).toEqual(['B'])
    expect(r.results.has('C')).toBe(true)
  })

  it('emits start, done, fail and skip events', async () => {
    const events: string[] = []
    const boom = op('A', [], async () => { throw new Error('nope') })
    await executeRun([boom, op('B', ['A']), op('C', [])], ctx(),
      opts({ onEvent: (e: { kind: string }) => events.push(e.kind) }))
    expect(events).toContain('start')
    expect(events).toContain('done')
    expect(events).toContain('fail')
    expect(events).toContain('skip')
  })

  it('times out a hanging operator instead of hanging the run', async () => {
    const hang = op('A', [], () => new Promise(() => {}))
    const r = await executeRun([hang], ctx(), opts({ timeoutMs: 40 }))
    expect(r.failed).toEqual(['A'])
  })

  it('wraps every operator in the supplied span function', async () => {
    const span = vi.fn(async (_n: string, _a: unknown, fn: () => Promise<unknown>) => fn())
    await executeRun([op('A', []), op('B', [])], ctx(), opts({ span }))
    expect(span).toHaveBeenCalledTimes(2)
  })

  it('starts an operator the moment its own needs are met, without waiting for a layer', async () => {
    // X and A are both free to start, and B needs only A. A layer barrier would hold
    // B back until X finished, so this deadlocks and times out under one. No sleeps:
    // X finishes only once B has run, which can only happen if B started while X was live.
    let releaseX: () => void = () => {}
    const xHeld = new Promise<void>(res => { releaseX = res })
    const ops = [op('X', [], () => xHeld), op('A', []), op('B', ['A'], async () => releaseX())]
    const r = await executeRun(ops, ctx(), opts({ timeoutMs: 500 }))
    expect(r.failed).toEqual([])
    expect([...r.results.keys()].sort()).toEqual(['A', 'B', 'X'])
  })

  it('cascades a skip down the whole chain and names the blocker', async () => {
    const events: FloorEvent[] = []
    const boom = op('A', [], async () => { throw new Error('nope') })
    const r = await executeRun([boom, op('B', ['A']), op('C', ['B']), op('D', [])], ctx(),
      opts({ onEvent: (e: FloorEvent) => events.push(e) }))
    expect(r.skipped).toEqual(['B', 'C'])
    const skips = events.filter(e => e.kind === 'skip')
    expect(skips.map(e => `${e.id} ${e.because}`)).toEqual(['B depends on A', 'C depends on B'])
    expect(r.totalOps).toBe(7)
  })

  it('writes nothing for a failed operator, so it can contribute no render params', async () => {
    const boom = op('A', [], async () => { throw new Error('nope') })
    const c = ctx()
    const r = await executeRun([boom, op('B', [])], c, opts())
    expect(c.results.has('A')).toBe(false)
    expect(r.results.has('A')).toBe(false)
    expect(r.totalOps).toBe(7)
  })

  it('fails an operator that resolves without a result rather than storing a hole', async () => {
    const empty: Operator = { ...op('A', []), run: (async () => undefined) as unknown as Operator['run'] }
    const r = await executeRun([empty, op('B', ['A'])], ctx(), opts())
    expect(r.failed).toEqual(['A'])
    expect(r.skipped).toEqual(['B'])
  })

  it('reports the error message on the fail event', async () => {
    const events: FloorEvent[] = []
    const boom = op('A', [], async () => { throw new Error('scraper is down') })
    await executeRun([boom], ctx(), opts({ onEvent: (e: FloorEvent) => events.push(e) }))
    const fail = events.find(e => e.kind === 'fail')
    expect(fail?.kind === 'fail' && fail.error).toBe('scraper is down')
  })

  it('keeps running when a listener throws', async () => {
    const r = await executeRun([op('A', []), op('B', [])], ctx(),
      opts({ onEvent: () => { throw new Error('the floor screen blew up') } }))
    expect(r.totalOps).toBe(14)
  })

  it('ignores a need that is not in the run set', async () => {
    const r = await executeRun([op('B', ['NOT_INCLUDED'])], ctx(), opts())
    expect(r.results.has('B')).toBe(true)
    expect(r.skipped).toEqual([])
  })

  it('lets a cycle throw before any operator runs', async () => {
    let ran = 0
    const A = op('A', ['B'], async () => { ran++ })
    const B = op('B', ['A'], async () => { ran++ })
    await expect(executeRun([A, B], ctx(), opts())).rejects.toThrow(/cycle/i)
    expect(ran).toBe(0)
  })
})
