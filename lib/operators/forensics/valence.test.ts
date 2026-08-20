import { describe, it, expect } from 'vitest'
import { VALENCE_ARC } from './valence'
import type { Ctx } from '../../types'

const ctx = (opinion: string): Ctx => ({ opinion, batchId: 't', results: new Map() })

const fieldType = (r: { contributions?: { path: string; value: unknown }[] }) =>
  String(r.contributions!.find((c) => c.path === 'field.type')!.value)

describe('VALENCE-ARC', () => {
  it('nets a rise and a fall to zero and reads the fall', async () => {
    const r = await VALENCE_ARC.run(ctx('I love this. I hate this.'))
    expect(r.readings.netValence).toBe(0)
    expect(r.readings.arcShape).toBe('falling')
    expect(r.readings.swing).toBe(2)
  })

  it('reads the same two sentences reversed as rising', async () => {
    const r = await VALENCE_ARC.run(ctx('I hate this. I love this.'))
    expect(r.readings.netValence).toBe(0)
    expect(r.readings.arcShape).toBe('rising')
  })

  it('reads unscored text as flat and neutral', async () => {
    const r = await VALENCE_ARC.run(ctx('Cats exist.'))
    expect(r.readings.netValence).toBe(0)
    expect(r.readings.arcShape).toBe('flat')
    expect(r.readings.swing).toBe(0)
    expect(fieldType(r)).toBe('lattice')
  })

  it('scores a sentence as its mean word valence', async () => {
    const r = await VALENCE_ARC.run(ctx('This is wonderful and great.'))
    expect(r.readings.netValence).toBeCloseTo(1.4, 10)
    expect(fieldType(r)).toBe('bloom')
  })

  it('sends a negative net to collapse', async () => {
    const r = await VALENCE_ARC.run(ctx('This is terrible and awful.'))
    expect(r.readings.netValence).toBeCloseTo(-1.2, 10)
    expect(fieldType(r)).toBe('collapse')
  })

  it('weights the claim by how far the net sits from neutral', async () => {
    const loud = await VALENCE_ARC.run(ctx('This is terrible and awful.'))
    const quiet = await VALENCE_ARC.run(ctx('Cats exist.'))
    expect(loud.contributions![0].weight).toBeCloseTo(0.8, 10)
    expect(quiet.contributions![0].weight).toBeCloseTo(0.8 * 0.2, 10)
  })

  it('reports the real lookup count as ops', async () => {
    const r = await VALENCE_ARC.run(ctx('I love this. I hate this.'))
    expect(r.ops).toBe(6 + 2)
  })

  it('declares itself', () => {
    expect(VALENCE_ARC.id).toBe('VALENCE-ARC')
    expect(VALENCE_ARC.wing).toBe('forensics')
    expect(VALENCE_ARC.needs).toEqual([])
    expect(VALENCE_ARC.touches).toEqual(['field.type'])
  })
})
