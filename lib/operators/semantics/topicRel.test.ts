import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { TOPIC_REL } from './topicRel'
import { WING_WEIGHT } from '../../types'
import type { Ctx, OperatorResult } from '../../types'

vi.mock('../../llm', () => ({ chatJson: vi.fn(), embed: vi.fn() }))

/**
 * A hand computable stand in for data/topics.json. The shipped file has no anchor
 * vectors yet, and it will have real ones later, so no test may depend on its
 * anchor state. The shape of the shipped file is checked separately, from disk.
 */
const { FIXTURE } = vi.hoisted(() => ({
  FIXTURE: [
    { name: 'alpha', ink: '#111111', anchorSentences: ['a'], anchor: [1, 0, 0, 0] },
    { name: 'beta', ink: '#222222', anchorSentences: ['b'], anchor: [0, 1, 0, 0] },
    { name: 'gamma', ink: '#333333', anchorSentences: ['c'], anchor: [3, 4, 0, 0] },
    { name: 'delta', ink: '#444444', anchorSentences: ['d'], anchor: [-1, 0, 0, 0] },
    { name: 'epsilon', ink: '#555555', anchorSentences: ['e'], anchor: [1, 1, 0, 0] },
    { name: 'zeta', ink: '#666666', anchorSentences: ['f'], anchor: [2, 1, 0, 0] },
    { name: 'eta', ink: '#777777', anchorSentences: ['g'], anchor: [1, 2, 0, 0] },
  ] as { name: string; ink: string; anchorSentences: string[]; anchor?: number[] }[],
}))

vi.mock('../../../data/topics.json', () => ({ default: FIXTURE }))

const embedResult = (vector: number[]): OperatorResult => ({
  id: 'EMBED',
  ops: 1,
  readings: { dims: vector.length, norm: 1 },
  notes: [JSON.stringify(vector)],
})

const ctx = (vector: number[]): Ctx => ({
  opinion: 'Anything at all.',
  batchId: 't',
  results: new Map([['EMBED', embedResult(vector)]]),
})

const contribution = (r: OperatorResult, path: string) =>
  (r.contributions ?? []).find((c) => c.path === path)

describe('TOPIC-REL', () => {
  it('declares its dependency and the two paths it writes', () => {
    expect(TOPIC_REL.id).toBe('TOPIC-REL')
    expect(TOPIC_REL.wing).toBe('semantics')
    expect(TOPIC_REL.needs).toEqual(['EMBED'])
    expect(TOPIC_REL.touches).toEqual(['palette.ink', 'dither.levels'])
  })

  it('names the topic whose anchor the batch vector matches, and takes its ink', async () => {
    // The batch vector is exactly the gamma anchor, so gamma scores 1.
    const r = await TOPIC_REL.run(ctx([3, 4, 0, 0]))
    expect(r.readings.topTopic).toBe('gamma')
    expect(r.readings.topScore).toBeCloseTo(1, 12)
    expect(contribution(r, 'palette.ink')?.value).toBe('#333333')
  })

  it('reports spread as the top score minus the second best', async () => {
    const r = await TOPIC_REL.run(ctx([3, 4, 0, 0]))
    // epsilon is second: 7 / (5 * sqrt(2)).
    const second = 7 / (5 * Math.SQRT2)
    expect(r.readings.spread).toBeCloseTo(1 - second, 10)
  })

  it('weights palette.ink by the winning score and dither.levels at a flat 0.6', async () => {
    const r = await TOPIC_REL.run(ctx([3, 4, 0, 0]))
    const ink = contribution(r, 'palette.ink')
    expect(ink?.weight).toBeCloseTo(WING_WEIGHT.semantics * (r.readings.topScore as number), 12)
    expect(contribution(r, 'dither.levels')?.weight).toBeCloseTo(WING_WEIGHT.semantics * 0.6, 12)
  })

  it('counts topics over 0.28 and clamps dither.levels to the 2 to 6 band', async () => {
    // Six of the seven anchors clear 0.28 against this vector, so 2 + 6 clamps to 6.
    const wide = await TOPIC_REL.run(ctx([3, 4, 0, 0]))
    expect(wide.readings.aboveThreshold).toBe(6)
    expect(contribution(wide, 'dither.levels')?.value).toBe(6)

    // Orthogonal to every anchor, so nothing clears the threshold.
    const narrow = await TOPIC_REL.run(ctx([0, 0, 0, 1]))
    expect(narrow.readings.aboveThreshold).toBe(0)
    expect(contribution(narrow, 'dither.levels')?.value).toBe(2)
  })

  it('always gives dither.levels a whole number', async () => {
    for (const vector of [[3, 4, 0, 0], [0, 0, 0, 1], [1, 1, 0, 0], [-2, 1, 0, 0]]) {
      const value = contribution(await TOPIC_REL.run(ctx(vector)), 'dither.levels')?.value
      expect(Number.isInteger(value)).toBe(true)
      expect(value as number).toBeGreaterThanOrEqual(2)
      expect(value as number).toBeLessThanOrEqual(6)
    }
  })

  it('throws naming the build script when a topic has no anchor, never scores against zero', async () => {
    const saved = FIXTURE[2].anchor
    delete FIXTURE[2].anchor
    try {
      await expect(TOPIC_REL.run(ctx([3, 4, 0, 0]))).rejects.toThrow(
        /scripts\/build-topic-anchors\.ts/,
      )
      await expect(TOPIC_REL.run(ctx([3, 4, 0, 0]))).rejects.toThrow(/gamma/)
    } finally {
      FIXTURE[2].anchor = saved
    }
  })

  it('treats an empty anchor as a missing one', async () => {
    const saved = FIXTURE[0].anchor
    FIXTURE[0].anchor = []
    try {
      await expect(TOPIC_REL.run(ctx([3, 4, 0, 0]))).rejects.toThrow(
        /scripts\/build-topic-anchors\.ts/,
      )
    } finally {
      FIXTURE[0].anchor = saved
    }
  })

  it('throws when the anchors were built by a different embedding model', async () => {
    const saved = FIXTURE[1].anchor
    FIXTURE[1].anchor = [1, 0]
    try {
      await expect(TOPIC_REL.run(ctx([3, 4, 0, 0]))).rejects.toThrow(/dims/i)
      await expect(TOPIC_REL.run(ctx([3, 4, 0, 0]))).rejects.toThrow(
        /scripts\/build-topic-anchors\.ts/,
      )
    } finally {
      FIXTURE[1].anchor = saved
    }
  })

  it('throws when EMBED has not run', async () => {
    const bare: Ctx = { opinion: 'x', batchId: 't', results: new Map() }
    await expect(TOPIC_REL.run(bare)).rejects.toThrow(/EMBED/)
  })
})

describe('data/topics.json as shipped', () => {
  const topics = JSON.parse(
    readFileSync(new URL('../../../data/topics.json', import.meta.url), 'utf8'),
  ) as { name: string; ink: string; anchorSentences: string[] }[]

  it('carries sixteen topics with unique names', () => {
    expect(topics).toHaveLength(16)
    expect(new Set(topics.map((t) => t.name)).size).toBe(16)
  })

  it('gives every topic a six digit hex ink and three anchor sentences', () => {
    for (const topic of topics) {
      expect(topic.ink).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(topic.anchorSentences).toHaveLength(3)
      for (const sentence of topic.anchorSentences) expect(sentence.length).toBeGreaterThan(20)
    }
    expect(new Set(topics.map((t) => t.ink)).size).toBe(16)
  })
})
