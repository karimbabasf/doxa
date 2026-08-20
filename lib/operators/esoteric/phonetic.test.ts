import { describe, it, expect } from 'vitest'
import { PHONETIC } from './phonetic'
import type { Ctx } from '../../types'

const ctx = (opinion: string): Ctx => ({ opinion, batchId: 't', results: new Map() })

const contrastOf = async (opinion: string) => {
  const r = await PHONETIC.run(ctx(opinion))
  return Number(r.contributions!.find((c) => c.path === 'dither.contrast')!.value)
}

describe('PHONETIC', () => {
  it('measures plosive density and the consonant to vowel ratio', async () => {
    const r = await PHONETIC.run(ctx('papa'))
    expect(r.readings.plosiveDensity).toBe(0.5)
    expect(r.readings.cvRatio).toBe(1)
  })

  it('reads a vowel run as no plosives and no consonants', async () => {
    const r = await PHONETIC.run(ctx('aaaa'))
    expect(r.readings.plosiveDensity).toBe(0)
    expect(r.readings.cvRatio).toBe(0)
  })

  it('counts all six plosives, and only those', async () => {
    const r = await PHONETIC.run(ctx('pbtdkg'))
    expect(r.readings.plosiveDensity).toBe(1)
    const s = await PHONETIC.run(ctx('smnlrf'))
    expect(s.readings.plosiveDensity).toBe(0)
  })

  it('divides by one, not by zero, when there are no vowels', async () => {
    const r = await PHONETIC.run(ctx('bbb'))
    expect(r.readings.cvRatio).toBe(3)
  })

  it('reads an empty opinion as zero, not as NaN', async () => {
    const r = await PHONETIC.run(ctx(''))
    expect(r.readings.plosiveDensity).toBe(0)
    expect(r.readings.cvRatio).toBe(0)
  })

  it('gives a plosive-heavy opinion strictly more contrast than a vowel-heavy one', async () => {
    expect(await contrastOf('kept tight, dropped dead')).toBeGreaterThan(
      await contrastOf('aeiou aeiou aeiou'),
    )
  })

  it('clamps contrast to 0.3 through 1.6', async () => {
    expect(await contrastOf('pbtdkg')).toBe(1.6) // 0.5 + 1.6 is 2.1 before the clamp
    for (const text of ['', 'aaaa', 'papa', 'pbtdkg', 'tabs beat spaces']) {
      const contrast = await contrastOf(text)
      expect(contrast).toBeGreaterThanOrEqual(0.3)
      expect(contrast).toBeLessThanOrEqual(1.6)
    }
  })

  it('contributes only the path it declares, and reports a real op count', async () => {
    const r = await PHONETIC.run(ctx('papa'))
    expect(r.ops).toBe(8)
    expect(r.contributions!.map((c) => c.path)).toEqual(['dither.contrast'])
    for (const c of r.contributions!) expect(PHONETIC.touches).toContain(c.path)
    expect(PHONETIC.needs).toEqual([])
  })
})
