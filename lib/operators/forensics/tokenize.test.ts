import { describe, it, expect } from 'vitest'
import { TOKENIZE } from './tokenize'
import type { Ctx } from '../../types'

const ctx = (opinion: string): Ctx => ({ opinion, batchId: 't', results: new Map() })

describe('TOKENIZE', () => {
  it('counts tokens and sentences', async () => {
    const r = await TOKENIZE.run(ctx('Tabs beat spaces. Always.'))
    expect(r.readings.tokenCount).toBe(4)
    expect(r.readings.sentenceCount).toBe(2)
  })

  it('reports the unique ratio', async () => {
    const r = await TOKENIZE.run(ctx('a a a b'))
    expect(r.readings.uniqueRatio).toBeCloseTo(0.5, 5)
  })

  it('reports a real operation count, not a constant', async () => {
    const short = await TOKENIZE.run(ctx('a b c'))
    const long = await TOKENIZE.run(ctx('a b c d e f g h i j'))
    expect(long.ops).toBeGreaterThan(short.ops)
  })

  it('declares no dependencies and writes no render params', () => {
    expect(TOKENIZE.needs).toEqual([])
    expect(TOKENIZE.touches).toEqual([])
  })
})
