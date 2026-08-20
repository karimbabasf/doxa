import { register } from '../registry'
import { cosine, readEmbedVector } from './embed'
import { WING_WEIGHT } from '../../types'
import type { Contribution, Operator } from '../../types'
import topicsJson from '../../../data/topics.json'

/**
 * Places the opinion in a fixed sixteen topic taxonomy and lets the winning topic
 * choose the ink. The taxonomy is fixed on purpose: an ink colour that means the
 * same thing across every specimen is worth more than a colour picked per run.
 */

export type Topic = {
  name: string
  ink: string
  anchorSentences: string[]
  /** Written by scripts/build-topic-anchors.ts, never by hand. */
  anchor?: number[]
}

const TOPICS = topicsJson as Topic[]

/** A cosine over this counts as the opinion touching that topic at all. */
const THRESHOLD = 0.28
const BUILD_HINT = 'Fix: pnpm dlx tsx scripts/build-topic-anchors.ts'

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * Anchors are checked before a single cosine runs. Scoring against a missing or
 * stale anchor does not fail, it returns a confident wrong topic and paints the
 * specimen the wrong colour, so this throws instead and names the repair.
 */
function anchorsOrThrow(dims: number): number[][] {
  const missing = TOPICS.filter((t) => !Array.isArray(t.anchor) || t.anchor.length === 0)
  if (missing.length > 0) {
    const names = missing.map((t) => t.name).join(', ')
    throw new Error(
      `TOPIC-REL cannot score: data/topics.json has no anchor vector for ${missing.length} of ` +
        `${TOPICS.length} topics (${names}). ${BUILD_HINT}`,
    )
  }
  const anchors = TOPICS.map((t) => t.anchor as number[])
  const stale = TOPICS.filter((t) => (t.anchor as number[]).length !== dims)
  if (stale.length > 0) {
    const names = stale.map((t) => `${t.name} (${(t.anchor as number[]).length})`).join(', ')
    throw new Error(
      `TOPIC-REL cannot score: the batch vector has ${dims} dims but these anchors do not ` +
        `match, so they were built by a different embedding model: ${names}. ${BUILD_HINT}`,
    )
  }
  return anchors
}

export const TOPIC_REL: Operator = {
  id: 'TOPIC-REL',
  name: 'Topic relation',
  wing: 'semantics',
  blurb: 'Scores the opinion against sixteen topic anchors and lets the winner pick the ink.',
  needs: ['EMBED'],
  costUnits: 1,
  estMs: 8,
  estOps: 16384,
  touches: ['palette.ink', 'dither.levels'],
  async run(ctx) {
    const vector = readEmbedVector(ctx)
    const anchors = anchorsOrThrow(vector.length)

    const scored = TOPICS.map((topic, i) => ({ topic, score: cosine(vector, anchors[i]) })).sort(
      (a, b) => b.score - a.score,
    )
    const top = scored[0]
    const spread = scored.length > 1 ? top.score - scored[1].score : top.score
    const aboveThreshold = scored.filter((s) => s.score > THRESHOLD).length
    const levels = clamp(2 + aboveThreshold, 2, 6)

    const contributions: Contribution[] = [
      {
        path: 'palette.ink',
        value: top.topic.ink,
        // A weak match argues quietly. A negative match does not argue at all.
        weight: Math.max(0, WING_WEIGHT.semantics * top.score),
      },
      {
        path: 'dither.levels',
        value: levels,
        weight: WING_WEIGHT.semantics * 0.6,
      },
    ]

    return {
      id: 'TOPIC-REL',
      // One dot product per topic, every dimension counted.
      ops: TOPICS.length * vector.length,
      readings: {
        topTopic: top.topic.name,
        topScore: top.score,
        spread,
        aboveThreshold,
      },
      contributions,
    }
  },
}

register(TOPIC_REL)
