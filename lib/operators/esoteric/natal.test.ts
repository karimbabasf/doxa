import { describe, it, expect } from 'vitest'
import { NATAL_CHART, signOf } from './natal'
import type { Ctx } from '../../types'

const ctx = (opinion: string): Ctx => ({ opinion, batchId: 't', results: new Map() })

describe('signOf', () => {
  it('maps a word to a sign by the sum of its character codes mod 12', () => {
    expect(signOf('a')).toBe(1)   // 97 % 12 === 1
    expect(signOf('abc')).toBe(6) // 294 % 12 === 6
  })
  it('is stable across calls', () => {
    expect(signOf('tabs')).toBe(signOf('tabs'))
  })
})

describe('NATAL-CHART', () => {
  it('element shares sum to one', async () => {
    const r = await NATAL_CHART.run(ctx('tabs beat spaces every single time'))
    const total = ['fire', 'earth', 'air', 'water']
      .reduce((a, k) => a + Number(r.readings[k]), 0)
    expect(total).toBeCloseTo(1, 6)
  })

  it('names one of the twelve signs', async () => {
    const r = await NATAL_CHART.run(ctx('tabs beat spaces'))
    expect(typeof r.readings.dominantSign).toBe('string')
    expect(String(r.readings.dominantSign).length).toBeGreaterThan(2)
  })

  it('gives different text different charts', async () => {
    const a = await NATAL_CHART.run(ctx('tabs beat spaces'))
    const b = await NATAL_CHART.run(ctx('spaces beat tabs entirely'))
    expect(a.readings.fire !== b.readings.fire || a.readings.water !== b.readings.water).toBe(true)
  })

  it('writes both of its declared paths', async () => {
    const r = await NATAL_CHART.run(ctx('tabs beat spaces'))
    const paths = r.contributions!.map(c => c.path).sort()
    expect(paths).toEqual(['palette.ground', 'primitives.arrangement'])
  })

  it('contributes only paths it declares, and reports a real op count', async () => {
    const short = await NATAL_CHART.run(ctx('tabs win'))
    const long = await NATAL_CHART.run(ctx('tabs beat spaces every single time and always will'))
    expect(long.ops).toBeGreaterThan(short.ops)
    for (const c of long.contributions!) expect(NATAL_CHART.touches).toContain(c.path)
    expect(NATAL_CHART.needs).toEqual([])
  })
})
