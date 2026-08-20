import { describe, it, expect } from 'vitest'
import { ZIPF_DRIFT } from './zipf'
import type { Ctx } from '../../types'

const ctx = (opinion: string): Ctx => ({ opinion, batchId: 't', results: new Map() })

const sizeBias = (r: { contributions?: { path: string; value: unknown }[] }) =>
  Number(r.contributions!.find((c) => c.path === 'primitives.sizeBias')!.value)

describe('ZIPF-DRIFT', () => {
  it('reads the commonest words in English as common', async () => {
    const r = await ZIPF_DRIFT.run(ctx('the and of to a'))
    expect(Number(r.readings.meanRarity)).toBeLessThan(2)
    expect(Number(r.readings.meanRarity)).toBeCloseTo(1.07612906, 6)
    expect(r.readings.unknownRatio).toBe(0)
  })

  it('reads words outside the top ten thousand as rare and unknown', async () => {
    const r = await ZIPF_DRIFT.run(ctx('perspicacious antediluvian sesquipedalian'))
    expect(Number(r.readings.meanRarity)).toBeGreaterThan(7)
    expect(Number(r.readings.unknownRatio)).toBeGreaterThan(0.5)
    expect(r.readings.meanRarity).toBe(10)
    expect(r.readings.unknownRatio).toBe(1)
  })

  it('skips stopwords when there is anything else to read', async () => {
    const withStop = await ZIPF_DRIFT.run(ctx('the quantum'))
    const bare = await ZIPF_DRIFT.run(ctx('quantum'))
    expect(withStop.readings.meanRarity).toBe(bare.readings.meanRarity)
    expect(withStop.readings.unknownRatio).toBe(0)
  })

  it('grows the size bias strictly as the vocabulary gets rarer', async () => {
    const mid = await ZIPF_DRIFT.run(ctx('music space review'))
    const rare = await ZIPF_DRIFT.run(ctx('quantum honest'))
    const mixed = await ZIPF_DRIFT.run(ctx('quantum perspicacious'))
    expect(sizeBias(mid)).toBeCloseTo(0.05036386, 6)
    expect(sizeBias(rare)).toBeCloseTo(0.21874975, 6)
    expect(sizeBias(mixed)).toBeCloseTo(0.60897426, 6)
    expect(sizeBias(mid)).toBeLessThan(sizeBias(rare))
    expect(sizeBias(rare)).toBeLessThan(sizeBias(mixed))
  })

  it('clamps the size bias at both ends', async () => {
    const common = await ZIPF_DRIFT.run(ctx('the and of to a'))
    const unknown = await ZIPF_DRIFT.run(ctx('perspicacious antediluvian sesquipedalian'))
    expect(sizeBias(common)).toBe(0)
    expect(sizeBias(unknown)).toBe(1)
  })

  it('handles empty text without dividing by zero', async () => {
    const r = await ZIPF_DRIFT.run(ctx('   '))
    expect(r.readings.meanRarity).toBe(0)
    expect(r.readings.unknownRatio).toBe(0)
    expect(r.ops).toBe(0)
  })

  it('carries a fixed weight', async () => {
    const r = await ZIPF_DRIFT.run(ctx('quantum honest'))
    expect(r.contributions![0].weight).toBeCloseTo(0.8 * 0.7, 10)
  })

  it('reports the real lookup count as ops', async () => {
    const r = await ZIPF_DRIFT.run(ctx('the quantum'))
    expect(r.ops).toBe(2 + 1)
  })

  it('declares itself', () => {
    expect(ZIPF_DRIFT.id).toBe('ZIPF-DRIFT')
    expect(ZIPF_DRIFT.wing).toBe('forensics')
    expect(ZIPF_DRIFT.needs).toEqual([])
    expect(ZIPF_DRIFT.touches).toEqual(['primitives.sizeBias'])
  })
})
