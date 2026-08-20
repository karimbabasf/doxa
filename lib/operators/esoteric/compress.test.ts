import { describe, it, expect } from 'vitest'
import { COMPRESS } from './compress'
import type { Ctx } from '../../types'

const ctx = (opinion: string): Ctx => ({ opinion, batchId: 't', results: new Map() })

const repeated = 'a'.repeat(32)
const distinct = 'abcdefghijklmnopqrstuvwxyz012345' // 32 characters, none repeated

const ratioOf = async (opinion: string) => Number((await COMPRESS.run(ctx(opinion))).readings.gzipRatio)

const octavesOf = async (opinion: string) => {
  const r = await COMPRESS.run(ctx(opinion))
  return Number(r.contributions!.find((c) => c.path === 'field.octaves')!.value)
}

describe('COMPRESS', () => {
  it('squeezes a repeated string harder than a string of distinct characters', async () => {
    expect(await ratioOf(repeated)).toBeLessThan(await ratioOf(distinct))
  })

  it('reports raw bytes, not character count', async () => {
    const r = await COMPRESS.run(ctx(repeated))
    expect(r.readings.rawBytes).toBe(Buffer.byteLength(repeated))
    const wide = await COMPRESS.run(ctx('你好'))
    expect(wide.readings.rawBytes).toBe(6)
  })

  it('returns the same ratio on every run of the same text', async () => {
    const first = await ratioOf('tabs beat spaces every single time')
    const second = await ratioOf('tabs beat spaces every single time')
    expect(first).toBe(second)
  })

  it('reads an empty opinion as zero, not as infinity', async () => {
    const r = await COMPRESS.run(ctx(''))
    expect(r.readings.rawBytes).toBe(0)
    expect(r.readings.gzipRatio).toBe(0)
  })

  it('turns the ratio into a whole octave count', async () => {
    expect(await octavesOf(repeated)).toBe(5)
    expect(Number.isInteger(await octavesOf('tabs beat spaces'))).toBe(true)
  })

  it('clamps octaves to 2 through 6', async () => {
    expect(await octavesOf('')).toBe(2)
    expect(await octavesOf(distinct)).toBe(6) // the raw value is past 8 before the clamp
    for (const text of ['', repeated, distinct, 'tabs beat spaces']) {
      const octaves = await octavesOf(text)
      expect(octaves).toBeGreaterThanOrEqual(2)
      expect(octaves).toBeLessThanOrEqual(6)
    }
  })

  it('contributes only the path it declares, and reports a real op count', async () => {
    const short = await COMPRESS.run(ctx('tabs'))
    const long = await COMPRESS.run(ctx('tabs beat spaces every single time and always will'))
    expect(long.ops).toBeGreaterThan(short.ops)
    expect(long.contributions!.map((c) => c.path)).toEqual(['field.octaves'])
    for (const c of long.contributions!) expect(COMPRESS.touches).toContain(c.path)
    expect(COMPRESS.needs).toEqual([])
  })
})
