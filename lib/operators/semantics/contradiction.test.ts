import { describe, it, expect, vi, beforeEach } from 'vitest'
import { embed } from '../../llm'
import { CONTRA_CHK, clauses } from './contradiction'
import { WING_WEIGHT } from '../../types'
import type { Ctx, OperatorResult } from '../../types'

vi.mock('../../llm', () => ({ chatJson: vi.fn(), embed: vi.fn() }))

const mockEmbed = vi.mocked(embed)
const ctx = (opinion: string): Ctx => ({ opinion, batchId: 't', results: new Map() })
const warp = (r: OperatorResult) => (r.contributions ?? []).find((c) => c.path === 'field.warpAmp')

beforeEach(() => {
  mockEmbed.mockReset()
})

describe('clauses', () => {
  it('gives one clause for one plain sentence', () => {
    expect(clauses('Cats rule.')).toEqual(['Cats rule.'])
  })

  it('splits on commas, semicolons and subordinators, the way PARSE-DEPTH counts them', () => {
    expect(clauses('Cats rule, because they are quiet, which matters.')).toHaveLength(3)
    expect(clauses('Cats rule; dogs drool.')).toHaveLength(2)
    expect(clauses('I stayed although it rained.')).toHaveLength(2)
  })

  it('drops the empty segments a back to back separator leaves behind', () => {
    for (const clause of clauses('Cats rule, because they are quiet, which matters.')) {
      expect(clause.trim()).toBe(clause)
      expect(clause.length).toBeGreaterThan(0)
    }
  })

  it('returns nothing for text with no words in it', () => {
    expect(clauses('   ')).toEqual([])
  })
})

describe('CONTRA-CHK', () => {
  it('declares its dependency and the one path it writes', () => {
    expect(CONTRA_CHK.id).toBe('CONTRA-CHK')
    expect(CONTRA_CHK.wing).toBe('semantics')
    expect(CONTRA_CHK.needs).toEqual(['EMBED'])
    expect(CONTRA_CHK.touches).toEqual(['field.warpAmp'])
  })

  it('leaves a single clause opinion at the low end of the warp band, with no model call', async () => {
    const r = await CONTRA_CHK.run(ctx('Cats rule.'))
    expect(r.readings.clausePairs).toBe(0)
    expect(r.readings.minPairCosine).toBe(1)
    expect(warp(r)?.value).toBeCloseTo(0.05, 12)
    expect(mockEmbed).not.toHaveBeenCalled()
  })

  it('drives the warp to the top of the band when two clauses point opposite ways', async () => {
    mockEmbed.mockResolvedValue([
      [1, 0],
      [-1, 0],
    ])
    const r = await CONTRA_CHK.run(ctx('Cats rule, because dogs drool.'))
    expect(r.readings.clausePairs).toBe(1)
    expect(r.readings.minPairCosine).toBeCloseTo(-1, 12)
    expect(warp(r)?.value).toBeCloseTo(0.9, 12)
  })

  it('takes the minimum cosine across every pair, not the mean', async () => {
    mockEmbed.mockResolvedValue([
      [1, 0],
      [0.99, 0.14],
      [-1, 0],
    ])
    const r = await CONTRA_CHK.run(ctx('Cats rule, because they are quiet, which matters.'))
    expect(r.readings.clausePairs).toBe(3)
    expect(r.readings.minPairCosine).toBeCloseTo(-1, 6)
    expect(warp(r)?.value).toBeCloseTo(0.9, 12)
  })

  it('lands mid band for clauses that are merely unrelated', async () => {
    mockEmbed.mockResolvedValue([
      [1, 0],
      [0, 1],
    ])
    const r = await CONTRA_CHK.run(ctx('Cats rule, because dogs drool.'))
    expect(r.readings.minPairCosine).toBeCloseTo(0, 12)
    expect(warp(r)?.value).toBeCloseTo(0.45, 12)
  })

  it('embeds every clause in one batched call', async () => {
    mockEmbed.mockResolvedValue([
      [1, 0],
      [0, 1],
      [1, 1],
    ])
    await CONTRA_CHK.run(ctx('Cats rule, because they are quiet, which matters.'))
    expect(mockEmbed).toHaveBeenCalledTimes(1)
    expect(mockEmbed.mock.calls[0][0]).toHaveLength(3)
  })

  it('argues at a flat eight tenths of the wing weight', async () => {
    mockEmbed.mockResolvedValue([
      [1, 0],
      [-1, 0],
    ])
    const r = await CONTRA_CHK.run(ctx('Cats rule, because dogs drool.'))
    expect(warp(r)?.weight).toBeCloseTo(WING_WEIGHT.semantics * 0.8, 12)
  })

  it('keeps field.warpAmp inside 0.05 to 0.9 whatever the cosines are', async () => {
    for (const pair of [
      [
        [1, 0],
        [1, 0],
      ],
      [
        [1, 0],
        [-1, 0],
      ],
      [
        [0, 0],
        [1, 0],
      ],
    ]) {
      mockEmbed.mockResolvedValue(pair)
      const value = warp(await CONTRA_CHK.run(ctx('Cats rule, because dogs drool.')))
        ?.value as number
      expect(value).toBeGreaterThanOrEqual(0.05)
      expect(value).toBeLessThanOrEqual(0.9)
    }
  })

  it('throws when the provider returns fewer vectors than there were clauses', async () => {
    mockEmbed.mockResolvedValue([[1, 0]])
    await expect(CONTRA_CHK.run(ctx('Cats rule, because dogs drool.'))).rejects.toThrow(/vector/i)
  })

  it('rethrows when the embedding call fails', async () => {
    mockEmbed.mockRejectedValue(new Error('NEAR AI /embeddings failed with 503: busy'))
    await expect(CONTRA_CHK.run(ctx('Cats rule, because dogs drool.'))).rejects.toThrow(/503/)
  })
})
