import { describe, it, expect } from 'vitest'
import { FK_READ } from './readability'
import type { Ctx } from '../../types'

const ctx = (opinion: string): Ctx => ({ opinion, batchId: 't', results: new Map() })

const scale = (r: { contributions?: { path: string; value: unknown }[] }) =>
  Number(r.contributions!.find((c) => c.path === 'field.scale')!.value)

const EASY = 'The dog ran to the park and the cat slept.'
const MEDIUM = 'The committee reviewed the proposal and then approved the final budget.'
const HARD = 'Although the committee reviewed the proposal, the revised regulation remained deeply unpopular.'

describe('FK-READ', () => {
  it('grades a three word sentence by the formula', async () => {
    const r = await FK_READ.run(ctx('The cat sat.'))
    // 0.39 * (3/1) + 11.8 * (3/3) - 15.59
    expect(Number(r.readings.fleschKincaid)).toBeCloseTo(-2.62, 2)
    expect(Number(r.readings.gunningFog)).toBeCloseTo(1.2, 10)
  })

  it('grades a long polysyllabic sentence strictly higher', async () => {
    const easy = await FK_READ.run(ctx('The cat sat.'))
    const hard = await FK_READ.run(ctx(HARD))
    expect(Number(hard.readings.fleschKincaid)).toBeGreaterThan(
      Number(easy.readings.fleschKincaid),
    )
    expect(Number(hard.readings.fleschKincaid)).toBeCloseTo(18.59, 6)
    expect(Number(hard.readings.gunningFog)).toBeCloseTo(28.133333, 5)
  })

  it('shrinks the feature scale as the grade level climbs', async () => {
    const easy = await FK_READ.run(ctx(EASY))
    const medium = await FK_READ.run(ctx(MEDIUM))
    const hard = await FK_READ.run(ctx(HARD))
    expect(scale(easy)).toBeCloseTo(1.3934, 6)
    expect(scale(medium)).toBeCloseTo(0.726364, 6)
    expect(scale(hard)).toBe(0.35)
    expect(scale(easy)).toBeGreaterThan(scale(medium))
    expect(scale(medium)).toBeGreaterThan(scale(hard))
  })

  it('clamps the scale at the easy end', async () => {
    const r = await FK_READ.run(ctx('The cat sat.'))
    expect(scale(r)).toBe(1.4)
  })

  it('returns zero grades for empty text instead of dividing by zero', async () => {
    const r = await FK_READ.run(ctx('   '))
    expect(r.readings.fleschKincaid).toBe(0)
    expect(r.readings.gunningFog).toBe(0)
    expect(r.ops).toBe(0)
  })

  it('carries a fixed weight', async () => {
    const r = await FK_READ.run(ctx(MEDIUM))
    expect(r.contributions![0].weight).toBeCloseTo(0.8 * 0.8, 10)
  })

  it('reports the real count as ops', async () => {
    const r = await FK_READ.run(ctx('The cat sat.'))
    expect(r.ops).toBe(3 * 2 + 1)
  })

  it('declares itself', () => {
    expect(FK_READ.id).toBe('FK-READ')
    expect(FK_READ.wing).toBe('forensics')
    expect(FK_READ.needs).toEqual([])
    expect(FK_READ.touches).toEqual(['field.scale'])
  })
})
