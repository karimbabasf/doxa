import { describe, it, expect } from 'vitest'
import { mergeContributions, weightFor } from './merge'
import type { OperatorResult, RenderPath, Wing } from '../types'

const full = (over: Partial<Record<RenderPath, [number | string | boolean, number]>> = {}): OperatorResult[] => {
  const base: Record<string, [number | string | boolean, number]> = {
    'field.type': ['bloom', 0.8], 'field.scale': [1, 0.8], 'field.warpAmp': [0.3, 0.7],
    'field.warpFreq': [1.2, 0.5], 'field.octaves': [4, 0.5],
    'primitives.count': [8, 0.5], 'primitives.arrangement': ['grid', 0.5], 'primitives.sizeBias': [0.4, 0.8],
    'dither.matrix': [4, 0.8], 'dither.levels': [3, 0.7], 'dither.contrast': [0.9, 0.5], 'dither.bias': [0, 0.8],
    'palette.ink': ['#c8f5d0', 0.7], 'palette.ground': ['#0b1116', 0.5],
    'frame.fill': [0.6, 0.8], 'frame.bleed': [false, 0.7], 'seed': [12345, 1],
    ...over,
  }
  return Object.entries(base).map(([path, [value, weight]], i) => ({
    id: `OP${i}`, ops: 1, readings: {},
    contributions: [{ path: path as RenderPath, value, weight }],
  }))
}

const claim = (id: string, path: RenderPath, value: number | string | boolean, weight: number): OperatorResult => ({
  id, ops: 1, readings: {}, contributions: [{ path, value, weight }],
})

describe('mergeContributions', () => {
  it('blends two numeric claims as a weighted mean', () => {
    const results = [
      ...full(),
      { id: 'X', ops: 1, readings: {}, contributions: [{ path: 'field.octaves' as RenderPath, value: 6, weight: 1.5 }] },
    ]
    const { params } = mergeContributions(results)
    // existing 4 at weight 0.5, new 6 at weight 1.5 -> (4*0.5 + 6*1.5) / 2 = 5.5, rounded to 6
    expect(params.field.octaves).toBe(6)
  })

  it('takes the highest weight for a categorical claim', () => {
    const results = [
      ...full(),
      { id: 'X', ops: 1, readings: {}, contributions: [{ path: 'field.type' as RenderPath, value: 'fracture', weight: 1.0 }] },
    ]
    expect(mergeContributions(results).params.field.type).toBe('fracture')
  })

  it('marks a blended path as blended and names the heaviest contributor', () => {
    const results = [
      ...full(),
      { id: 'HEAVY', ops: 1, readings: {}, contributions: [{ path: 'field.octaves' as RenderPath, value: 6, weight: 1.5 }] },
    ]
    const { attribution } = mergeContributions(results)
    expect(attribution['field.octaves'].blended).toBe(true)
    expect(attribution['field.octaves'].dominant).toBe('HEAVY')
  })

  it('marks a single-contributor path as not blended', () => {
    const { attribution } = mergeContributions(full())
    expect(attribution['seed'].blended).toBe(false)
  })

  it('throws naming any path no operator claimed', () => {
    const partial = full().filter(r => r.contributions![0].path !== 'palette.ink')
    expect(() => mergeContributions(partial)).toThrow(/palette\.ink/)
  })

  it('rounds integer paths to integers', () => {
    const { params } = mergeContributions(full({ 'primitives.count': [8.6, 0.5] }))
    expect(Number.isInteger(params.primitives.count)).toBe(true)
  })

  it('names every unclaimed path in one message', () => {
    const partial = full().filter(r => {
      const p = r.contributions![0].path
      return p !== 'palette.ink' && p !== 'frame.fill'
    })
    expect(() => mergeContributions(partial)).toThrow(/palette\.ink/)
    expect(() => mergeContributions(partial)).toThrow(/frame\.fill/)
  })

  it('treats a path claimed only at zero weight as unresolved', () => {
    expect(() => mergeContributions(full({ 'palette.ink': ['#ffffff', 0] }))).toThrow(/palette\.ink/)
  })

  it('carries every contributor into attribution, heaviest first', () => {
    const results = [...full(), claim('LIGHT', 'field.octaves', 2, 0.1), claim('HEAVY', 'field.octaves', 6, 1.5)]
    const { attribution } = mergeContributions(results)
    expect(attribution['field.octaves'].contributors).toEqual([
      { operatorId: 'HEAVY', value: 6, weight: 1.5 },
      { operatorId: 'OP4', value: 4, weight: 0.5 },
      { operatorId: 'LIGHT', value: 2, weight: 0.1 },
    ])
  })

  it('reports a numeric path with two claims as blended and a contested categorical as contested', () => {
    const results = [...full(), claim('X', 'field.octaves', 6, 1.5), claim('Y', 'field.type', 'fracture', 1.0)]
    const { attribution } = mergeContributions(results)
    expect(attribution['field.octaves'].mode).toBe('blended')
    expect(attribution['field.type'].mode).toBe('contested')
    expect(attribution['field.type'].blended).toBe(true)
    expect(attribution['seed'].mode).toBe('sole')
  })

  it('breaks a categorical tie by operator id when no wings are given', () => {
    const results = [...full(), claim('ZEBRA', 'field.type', 'lattice', 0.8)]
    expect(mergeContributions(results).params.field.type).toBe('bloom')
  })

  it('breaks a categorical tie by wing order when wings are given', () => {
    const results = [...full(), claim('ZEBRA', 'field.type', 'lattice', 0.8)]
    const wings: Record<string, Wing> = { OP0: 'semantics', ZEBRA: 'field' }
    expect(mergeContributions(results, { wings }).params.field.type).toBe('lattice')
  })

  it('snaps a blended dither matrix to the nearest of 2, 4 and 8', () => {
    const results = [...full({ 'dither.matrix': [4, 1] }), claim('X', 'dither.matrix', 8, 1)]
    // (4 + 8) / 2 = 6 exactly, equidistant from 4 and 8, so it takes the smaller
    expect(mergeContributions(results).params.dither.matrix).toBe(4)
    const high = [...full({ 'dither.matrix': [8, 0.8] }), claim('X', 'dither.matrix', 7, 0.8)]
    expect(mergeContributions(high).params.dither.matrix).toBe(8)
  })

  it('keeps every merged value exact', () => {
    const results = [...full(), claim('X', 'frame.fill', 0.2, 0.2)]
    const { params } = mergeContributions(results)
    // (0.6*0.8 + 0.2*0.2) / 1.0 = 0.52
    expect(params.frame.fill).toBeCloseTo(0.52, 10)
    expect(params.palette.ink).toBe('#c8f5d0')
    expect(params.frame.bleed).toBe(false)
    expect(params.seed).toBe(12345)
    expect(params.primitives.arrangement).toBe('grid')
  })

  it('rejects a claim whose value is the wrong kind for its path', () => {
    expect(() => mergeContributions([...full(), claim('X', 'field.scale', 'big', 0.5)])).toThrow(/field\.scale/)
    expect(() => mergeContributions([...full(), claim('X', 'palette.ink', 4, 0.5)])).toThrow(/palette\.ink/)
  })

  it('rejects a negative or non finite weight', () => {
    expect(() => mergeContributions([...full(), claim('X', 'field.scale', 2, -1)])).toThrow(/X/)
    expect(() => mergeContributions([...full(), claim('X', 'field.scale', 2, Number.NaN)])).toThrow(/X/)
  })

  it('ignores results that carry no contributions', () => {
    const quiet: OperatorResult = { id: 'QUIET', ops: 1, readings: {} }
    expect(mergeContributions([...full(), quiet]).params.seed).toBe(12345)
  })
})

describe('weightFor', () => {
  it('scales the wing weight by confidence', () => {
    expect(weightFor('field', 1)).toBe(1)
    expect(weightFor('forensics', 0.5)).toBeCloseTo(0.4, 10)
    expect(weightFor('esoteric', 0.5)).toBeCloseTo(0.25, 10)
  })

  it('defaults to the full wing weight and clamps confidence to 0 through 1', () => {
    expect(weightFor('semantics')).toBe(0.7)
    expect(weightFor('semantics', 4)).toBe(0.7)
    expect(weightFor('semantics', -1)).toBe(0)
  })
})
