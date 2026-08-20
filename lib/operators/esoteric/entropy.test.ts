import { describe, it, expect } from 'vitest'
import { ENTROPY } from './entropy'
import type { Ctx } from '../../types'

const ctx = (opinion: string): Ctx => ({ opinion, batchId: 't', results: new Map() })

const warpFreqOf = async (opinion: string) => {
  const r = await ENTROPY.run(ctx(opinion))
  return Number(r.contributions!.find((c) => c.path === 'field.warpFreq')!.value)
}

/** Every printable ASCII character once, so every character is equally likely. */
const flat = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('')

describe('ENTROPY', () => {
  it('reads a two character even split as exactly one bit', async () => {
    const r = await ENTROPY.run(ctx('aabb'))
    expect(r.readings.shannon).toBe(1)
    expect(r.readings.maxShannon).toBe(1)
  })

  it('reads a single repeated character as zero bits', async () => {
    const r = await ENTROPY.run(ctx('aaaa'))
    expect(r.readings.shannon).toBe(0)
    expect(r.readings.maxShannon).toBe(0)
  })

  it('reads four distinct characters as exactly two bits', async () => {
    const r = await ENTROPY.run(ctx('abcd'))
    expect(r.readings.shannon).toBe(2)
    expect(r.readings.maxShannon).toBe(2)
  })

  it('counts every character, not just the letters', async () => {
    const r = await ENTROPY.run(ctx('ab ab'))
    expect(r.readings.maxShannon).toBe(Math.log2(3))
  })

  it('reads an empty opinion as zero, not as minus infinity', async () => {
    const r = await ENTROPY.run(ctx(''))
    expect(r.readings.shannon).toBe(0)
    expect(r.readings.maxShannon).toBe(0)
  })

  it('gives a high entropy opinion strictly more warp than a low entropy one', async () => {
    expect(await warpFreqOf('tabs beat spaces every single time')).toBeGreaterThan(
      await warpFreqOf('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    )
  })

  it('clamps warp frequency to 0.6 through 3.2', async () => {
    expect(await warpFreqOf('aaaa')).toBe(0.6)
    expect(await warpFreqOf(flat)).toBe(3.2) // log2(95) puts the raw value past 3.8
    for (const text of ['', 'aaaa', 'abcd', flat, 'tabs beat spaces']) {
      const warp = await warpFreqOf(text)
      expect(warp).toBeGreaterThanOrEqual(0.6)
      expect(warp).toBeLessThanOrEqual(3.2)
    }
  })

  it('contributes only the path it declares, and reports a real op count', async () => {
    const r = await ENTROPY.run(ctx('aabb'))
    expect(r.ops).toBe(6) // 2 distinct characters plus 4 characters read
    expect(r.contributions!.map((c) => c.path)).toEqual(['field.warpFreq'])
    for (const c of r.contributions!) expect(ENTROPY.touches).toContain(c.path)
    expect(ENTROPY.needs).toEqual([])
  })
})
