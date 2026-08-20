import { register } from '../registry'
import { embed as embedTexts } from '../../llm'
import { cosine } from './embed'
import { sentences } from '../../text'
import { WING_WEIGHT } from '../../types'
import type { Contribution, Operator } from '../../types'

/**
 * Looks for the opinion arguing with itself. Every clause is embedded and every
 * pair is scored, and the worst pair sets the warp: text that holds two opposed
 * ideas at once gets a field that visibly pulls against itself.
 */

/**
 * The same clause split PARSE-DEPTH counts with, kept local on purpose so the two
 * operators can be scheduled in either order and neither imports the other. If the
 * splitter ever moves to lib/text.ts, both call sites change together.
 */
const SUBORDINATORS = [
  'because',
  'which',
  'that',
  'although',
  'while',
  'since',
  'unless',
  'whereas',
  'if',
  'when',
]
const SPLITTER = new RegExp(`[,;]|\\b(?:${SUBORDINATORS.join('|')})\\b`, 'i')

/** Clause segments, in reading order. A separator sitting next to another leaves no empty. */
export function clauses(text: string): string[] {
  return sentences(text).flatMap((sentence) =>
    sentence
      .split(SPLITTER)
      .map((clause) => clause.trim())
      .filter((clause) => clause.length > 0),
  )
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

export const CONTRA_CHK: Operator = {
  id: 'CONTRA-CHK',
  name: 'Contradiction check',
  wing: 'semantics',
  blurb: 'Scores every clause against every other and reports the pair that disagrees most.',
  needs: ['EMBED'],
  costUnits: 3,
  estMs: 550,
  estOps: 2048,
  touches: ['field.warpAmp'],
  async run(ctx) {
    const parts = clauses(ctx.opinion)

    // One clause cannot contradict itself, and an embedding call for it would be
    // a charge with nothing to compare against.
    let minPairCosine = 1
    let clausePairs = 0
    let dims = 0

    if (parts.length >= 2) {
      const vectors = await embedTexts(parts)
      if (vectors.length < parts.length) {
        throw new Error(
          `CONTRA-CHK got ${vectors.length} vectors back for ${parts.length} clauses.`,
        )
      }
      dims = vectors[0].length
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          clausePairs++
          const score = cosine(vectors[i], vectors[j])
          if (score < minPairCosine) minPairCosine = score
        }
      }
    }

    const contributions: Contribution[] = [
      {
        path: 'field.warpAmp',
        value: clamp((1 - minPairCosine) * 0.45, 0.05, 0.9),
        weight: WING_WEIGHT.semantics * 0.8,
      },
    ]

    return {
      id: 'CONTRA-CHK',
      // Characters read plus one dot product per pair, every dimension counted.
      ops: ctx.opinion.length + clausePairs * dims,
      readings: { minPairCosine, clausePairs },
      contributions,
    }
  },
}

register(CONTRA_CHK)
