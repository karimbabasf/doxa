/**
 * The gap a live run found: every operator green, and no specimen.
 *
 * The planner may pick any subset and the foundry refuses to default a parameter nobody
 * measured, so nothing connected the two. A six operator plan touched five of seventeen
 * render paths, the merge threw, and the run ended with no image.
 */
import { describe, it, expect } from 'vitest'
import { uncoveredPaths, coverageAdditions } from './plan'
import { ALL_OPERATORS } from '../operators'
import { getOperator, resolveDeps } from '../operators/registry'
import { ALL_RENDER_PATHS, type RenderPath } from '../types'

/** The exact set the live planner returned for "Typed languages make teams slower, not safer." */
const LIVE_PICK = ['MODALITY', 'RHETORIC', 'TOKENIZE', 'VALENCE-ARC', 'CLAIM-EX', 'STANCE']

const covers = (ids: string[]): Set<RenderPath> => {
  const out = new Set<RenderPath>()
  for (const id of resolveDeps(ids)) for (const p of getOperator(id).touches) out.add(p)
  return out
}

describe('render coverage', () => {
  it('reports the paths a partial plan leaves unmeasured', () => {
    const missing = uncoveredPaths(LIVE_PICK)
    expect(missing.length).toBeGreaterThan(0)
    expect(missing).toContain('seed')
  })

  it('reports nothing missing for the whole library', () => {
    expect(uncoveredPaths(ALL_OPERATORS.map(o => o.id))).toEqual([])
  })

  it('covers every remaining path for the plan that failed live', () => {
    const additions = coverageAdditions(LIVE_PICK)
    const final = [...LIVE_PICK, ...additions.map(a => a.id)]
    expect(uncoveredPaths(final)).toEqual([])
  })

  it('leaves a plan alone when it already covers everything', () => {
    expect(coverageAdditions(ALL_OPERATORS.map(o => o.id))).toEqual([])
  })

  it('never pulls in a field operator, because that spends a scrape the planner declined', () => {
    const additions = coverageAdditions(LIVE_PICK)
    for (const a of additions) expect(getOperator(a.id).wing).not.toBe('field')
  })

  it('is deterministic, so the same opinion always gets the same plan', () => {
    const a = coverageAdditions(LIVE_PICK).map(x => x.id)
    const b = coverageAdditions(LIVE_PICK).map(x => x.id)
    expect(a).toEqual(b)
  })

  it('only claims to cover paths the added operator actually touches', () => {
    for (const a of coverageAdditions(LIVE_PICK)) {
      expect(getOperator(a.id).touches).toEqual(expect.arrayContaining(a.covers))
    }
  })

  it('covers everything even from a single operator', () => {
    const additions = coverageAdditions(['TOKENIZE'])
    expect(uncoveredPaths(['TOKENIZE', ...additions.map(a => a.id)])).toEqual([])
  })

  it('adds few operators, not the whole library', () => {
    expect(coverageAdditions(LIVE_PICK).length).toBeLessThan(ALL_RENDER_PATHS.length)
  })

  it('the union of the final plan matches every declared render path', () => {
    const additions = coverageAdditions(LIVE_PICK)
    expect([...covers([...LIVE_PICK, ...additions.map(a => a.id)])].sort())
      .toEqual([...ALL_RENDER_PATHS].sort())
  })
})
