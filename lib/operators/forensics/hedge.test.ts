import { describe, it, expect } from 'vitest'
import { HEDGE_7 } from './hedge'
import type { Ctx } from '../../types'

const ctx = (opinion: string): Ctx => ({ opinion, batchId: 't', results: new Map() })

const matrix = (r: { contributions?: { path: string; value: unknown }[] }) =>
  Number(r.contributions!.find((c) => c.path === 'dither.matrix')!.value)

describe('HEDGE-7', () => {
  it('counts hedges', async () => {
    const r = await HEDGE_7.run(ctx('I think this is maybe sort of fine.'))
    expect(r.readings.hedgeHits).toBe(3)
    expect(r.readings.boosterHits).toBe(0)
  })

  it('counts boosters', async () => {
    const r = await HEDGE_7.run(ctx('This is obviously and literally always wrong.'))
    expect(r.readings.boosterHits).toBe(3)
    expect(r.readings.hedgeHits).toBe(0)
  })

  it('scores a longer phrase once, not also as its shorter parts', async () => {
    const r = await HEDGE_7.run(ctx('It could be fine.'))
    expect(r.readings.hedgeHits).toBe(1)
  })

  it('scores a blunt take above a hedged one', async () => {
    const blunt = await HEDGE_7.run(ctx('This is obviously garbage.'))
    const hedged = await HEDGE_7.run(ctx('This is maybe not great.'))
    expect(blunt.readings.netConviction).toBe(1)
    expect(hedged.readings.netConviction).toBe(-1)
  })

  it('holds net conviction at zero when nothing is marked', async () => {
    const r = await HEDGE_7.run(ctx('Cats exist.'))
    expect(r.readings.netConviction).toBe(0)
    expect(matrix(r)).toBe(4)
  })

  it('gives a blunt take a coarse dither and a hedged take a fine one', async () => {
    const blunt = await HEDGE_7.run(ctx('This is obviously literally always garbage.'))
    const hedged = await HEDGE_7.run(ctx('I think this is maybe sort of perhaps not great.'))
    expect(matrix(blunt)).toBe(2)
    expect(matrix(hedged)).toBe(8)
    expect(matrix(blunt)).toBeLessThan(matrix(hedged))
  })

  it('weights the claim by how far from neutral it landed', async () => {
    const blunt = await HEDGE_7.run(ctx('This is obviously garbage.'))
    const neutral = await HEDGE_7.run(ctx('Cats exist.'))
    expect(blunt.contributions![0].weight).toBeCloseTo(0.8, 10)
    expect(neutral.contributions![0].weight).toBeCloseTo(0.8 * 0.3, 10)
  })

  it('reports the real comparison count as ops', async () => {
    const r = await HEDGE_7.run(ctx('I think this is maybe sort of fine.'))
    expect(r.ops).toBe(33 * 8)
  })

  it('declares itself', () => {
    expect(HEDGE_7.id).toBe('HEDGE-7')
    expect(HEDGE_7.wing).toBe('forensics')
    expect(HEDGE_7.needs).toEqual([])
    expect(HEDGE_7.touches).toEqual(['dither.matrix'])
  })
})
