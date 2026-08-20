import { describe, it, expect, vi, beforeEach } from 'vitest'
import { embed } from '../../llm'
import { EMBED, cosine, readEmbedVector } from './embed'
import type { Ctx } from '../../types'

vi.mock('../../llm', () => ({ chatJson: vi.fn(), embed: vi.fn() }))

const mockEmbed = vi.mocked(embed)
const ctx = (opinion: string): Ctx => ({ opinion, batchId: 't', results: new Map() })

beforeEach(() => {
  mockEmbed.mockReset()
})

describe('cosine', () => {
  it('gives 1 for identical unit vectors', () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBe(1)
    expect(cosine([0, 1], [0, 1])).toBe(1)
  })

  it('gives 0 for orthogonal vectors', () => {
    expect(cosine([1, 0], [0, 1])).toBe(0)
    expect(cosine([1, 0, 0], [0, 0, 3])).toBe(0)
  })

  it('gives -1 for opposite vectors', () => {
    expect(cosine([1, 0, 0], [-1, 0, 0])).toBe(-1)
    expect(cosine([0.5, 0.5], [-2, -2])).toBeCloseTo(-1, 12)
  })

  it('gives 0 rather than NaN when either vector has zero magnitude', () => {
    expect(cosine([0, 0, 0], [1, 2, 3])).toBe(0)
    expect(cosine([1, 2, 3], [0, 0, 0])).toBe(0)
    expect(cosine([], [])).toBe(0)
    for (const value of [cosine([0, 0], [0, 0]), cosine([0, 0, 0], [1, 2, 3])]) {
      expect(Number.isNaN(value)).toBe(false)
    }
  })

  it('ignores magnitude, so a scaled copy still scores 1', () => {
    expect(cosine([3, 4], [30, 40])).toBeCloseTo(1, 12)
  })

  it('throws on a dimension mismatch rather than scoring the overlap', () => {
    expect(() => cosine([1, 0], [1, 0, 0])).toThrow(/dimension/i)
  })
})

describe('EMBED', () => {
  it('declares itself as a semantics operator that writes no render path', () => {
    expect(EMBED.id).toBe('EMBED')
    expect(EMBED.wing).toBe('semantics')
    expect(EMBED.needs).toEqual(['TOKENIZE'])
    expect(EMBED.touches).toEqual([])
    expect(EMBED.costUnits).toBe(3)
  })

  it('reports the vector length in readings.dims and its magnitude in readings.norm', async () => {
    mockEmbed.mockResolvedValue([[3, 4, 0, 0]])
    const r = await EMBED.run(ctx('Tabs beat spaces.'))
    expect(r.id).toBe('EMBED')
    expect(r.readings.dims).toBe(4)
    expect(r.readings.norm).toBeCloseTo(5, 12)
  })

  it('embeds the opinion itself, in one batched call', async () => {
    const opinion = 'Remote work killed the junior engineer pipeline.'
    mockEmbed.mockResolvedValue([[1, 0]])
    await EMBED.run(ctx(opinion))
    expect(mockEmbed).toHaveBeenCalledTimes(1)
    expect(mockEmbed.mock.calls[0][0]).toEqual([opinion])
  })

  it('stores the vector in notes[0] as JSON, since readings holds only scalars', async () => {
    const vector = [0.1, -0.25, 0.5]
    mockEmbed.mockResolvedValue([vector])
    const r = await EMBED.run(ctx('Anything.'))
    expect(r.notes).toBeDefined()
    expect(JSON.parse((r.notes as string[])[0])).toEqual(vector)
    for (const value of Object.values(r.readings)) {
      expect(typeof value === 'number' || typeof value === 'string').toBe(true)
    }
  })

  it('hands the vector to downstream operators through ctx.results', async () => {
    const vector = [0.2, 0.4, 0.6, 0.8]
    mockEmbed.mockResolvedValue([vector])
    const c = ctx('Anything.')
    const r = await EMBED.run(c)
    // What the executor does between operators.
    c.results.set('EMBED', r)
    expect(readEmbedVector(c)).toEqual(vector)
  })

  it('throws an actionable error when EMBED has not run yet', () => {
    expect(() => readEmbedVector(ctx('Anything.'))).toThrow(/EMBED/)
  })

  it('throws when the provider returns no vector, rather than passing an empty one on', async () => {
    mockEmbed.mockResolvedValue([])
    await expect(EMBED.run(ctx('Anything.'))).rejects.toThrow(/vector/i)
  })

  it('rethrows when the embedding call fails', async () => {
    mockEmbed.mockRejectedValue(new Error('NEAR AI /embeddings failed with 503: busy'))
    await expect(EMBED.run(ctx('Anything.'))).rejects.toThrow(/503/)
  })
})
