import { describe, it, expect } from 'vitest'
import { PRIME_SIG, fnv1a } from './prime'
import type { Ctx } from '../../types'

const ctx = (opinion: string): Ctx => ({ opinion, batchId: 't', results: new Map() })

const seedOf = async (opinion: string) => {
  const r = await PRIME_SIG.run(ctx(opinion))
  return Number(r.contributions!.find((c) => c.path === 'seed')!.value)
}

describe('fnv1a', () => {
  it('returns the offset basis for an empty string', () => {
    expect(fnv1a('')).toBe(0x811c9dc5)
  })

  it('separates anagrams, which a character-code sum cannot', () => {
    expect(fnv1a('abc')).not.toBe(fnv1a('cba'))
  })

  it('separates strings that differ by one character', () => {
    expect(fnv1a('tabs beat spaces')).not.toBe(fnv1a('tabs beat space'))
    expect(fnv1a('tabs beat spaces')).not.toBe(fnv1a('Tabs beat spaces'))
  })

  it('stays a non-negative 32-bit integer over long input', () => {
    const h = fnv1a('z'.repeat(5000))
    expect(Number.isInteger(h)).toBe(true)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThanOrEqual(0xffffffff)
  })
})

describe('PRIME-SIG', () => {
  it('factorises the character-code sum', async () => {
    const r = await PRIME_SIG.run(ctx('abc')) // 97 + 98 + 99 === 294
    expect(r.readings.signature).toBe('2 x 3 x 7^2')
    expect(r.readings.factorCount).toBe(3)
    expect(r.readings.largestPrime).toBe(7)
  })

  it('reports a prime sum as itself', async () => {
    const r = await PRIME_SIG.run(ctx('a')) // 97 is prime
    expect(r.readings.signature).toBe('97')
    expect(r.readings.factorCount).toBe(1)
    expect(r.readings.largestPrime).toBe(97)
  })

  it('has nothing to factorise in an empty opinion', async () => {
    const r = await PRIME_SIG.run(ctx(''))
    expect(r.readings.signature).toBe('0')
    expect(r.readings.factorCount).toBe(0)
    expect(r.readings.largestPrime).toBe(0)
  })

  it('gives the same text the same seed every time', async () => {
    expect(await seedOf('tabs beat spaces')).toBe(await seedOf('tabs beat spaces'))
  })

  it('gives different texts different seeds', async () => {
    const seeds = await Promise.all([
      seedOf('tabs beat spaces'),
      seedOf('spaces beat tabs'),
      seedOf('tabs beat spaces.'),
      seedOf('cba'),
      seedOf('abc'),
    ].map((p) => p))
    expect(new Set(seeds).size).toBe(seeds.length)
  })

  it('seeds off the whole string, not the code sum, so anagrams diverge', async () => {
    const a = await PRIME_SIG.run(ctx('abc'))
    const b = await PRIME_SIG.run(ctx('cba'))
    expect(a.readings.signature).toBe(b.readings.signature)
    expect(await seedOf('abc')).not.toBe(await seedOf('cba'))
  })

  it('emits a non-negative 32-bit integer seed at full weight', async () => {
    const r = await PRIME_SIG.run(ctx('tabs beat spaces every single time'))
    const seed = r.contributions!.find((c) => c.path === 'seed')!
    expect(Number.isInteger(seed.value)).toBe(true)
    expect(Number(seed.value)).toBeGreaterThanOrEqual(0)
    expect(Number(seed.value)).toBeLessThanOrEqual(0xffffffff)
    expect(seed.weight).toBe(1.0)
  })

  it('counts real trial divisions', async () => {
    const short = await PRIME_SIG.run(ctx('a'))
    const long = await PRIME_SIG.run(ctx('tabs beat spaces every single time'))
    expect(short.ops).toBeGreaterThan(0)
    expect(long.ops).toBeGreaterThan(short.ops)
  })

  it('contributes only the path it declares', async () => {
    const r = await PRIME_SIG.run(ctx('tabs beat spaces'))
    expect(r.contributions!.map((c) => c.path)).toEqual(['seed'])
    for (const c of r.contributions!) expect(PRIME_SIG.touches).toContain(c.path)
    expect(PRIME_SIG.needs).toEqual([])
  })
})
