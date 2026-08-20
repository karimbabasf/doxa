import { describe, it, expect } from 'vitest'
import { GEMATRIA } from './gematria'
import type { Ctx } from '../../types'

const ctx = (opinion: string): Ctx => ({ opinion, batchId: 't', results: new Map() })

const countOf = async (opinion: string) => {
  const r = await GEMATRIA.run(ctx(opinion))
  return Number(r.contributions!.find((c) => c.path === 'primitives.count')!.value)
}

describe('GEMATRIA', () => {
  it('sums a=1 through z=26', async () => {
    const r = await GEMATRIA.run(ctx('abc'))
    expect(r.readings.letterSum).toBe(6)
    expect(r.readings.digitalRoot).toBe(6)
  })

  it('takes the digital root of a sum past nine', async () => {
    const r = await GEMATRIA.run(ctx('zz'))
    expect(r.readings.letterSum).toBe(52)
    expect(r.readings.digitalRoot).toBe(7) // 1 + (52 - 1) % 9
  })

  it('ignores anything that is not a letter', async () => {
    const r = await GEMATRIA.run(ctx('A, B! C?'))
    expect(r.readings.letterSum).toBe(6)
  })

  it('reads an empty opinion as zero, not as NaN', async () => {
    const r = await GEMATRIA.run(ctx(''))
    expect(r.readings.letterSum).toBe(0)
    expect(r.readings.digitalRoot).toBe(0)
  })

  it('turns the root into an exact primitive count', async () => {
    expect(await countOf('abc')).toBe(16) // 3 + 6 * 2 + 6 % 5
    expect(await countOf('zz')).toBe(19)  // 3 + 7 * 2 + 52 % 5
  })

  it('clamps the primitive count to 3 through 24', async () => {
    expect(await countOf('')).toBe(3)
    expect(await countOf('i')).toBe(24) // 3 + 9 * 2 + 9 % 5 is 25 before the clamp
    for (const text of ['', 'i', 'zz', 'tabs beat spaces', 'z'.repeat(400)]) {
      const count = await countOf(text)
      expect(count).toBeGreaterThanOrEqual(3)
      expect(count).toBeLessThanOrEqual(24)
    }
  })

  it('contributes only the path it declares, and reports a real op count', async () => {
    const r = await GEMATRIA.run(ctx('tabs beat spaces'))
    expect(r.ops).toBe(14)
    expect(r.contributions!.map((c) => c.path)).toEqual(['primitives.count'])
    for (const c of r.contributions!) expect(GEMATRIA.touches).toContain(c.path)
    expect(GEMATRIA.needs).toEqual([])
  })
})
