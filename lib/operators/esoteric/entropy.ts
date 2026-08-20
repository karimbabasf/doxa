import { register } from '../registry'
import { WING_WEIGHT, type Operator } from '../../types'

/**
 * Shannon entropy over the character distribution of the raw opinion, in bits.
 * It answers one question: how many bits it takes to name the next character.
 * A line that leans on the same few characters is cheap to predict and gets a
 * slow warp; a line that spends its whole alphabet is expensive and gets a fast
 * one. `maxShannon` is the ceiling for that many distinct characters, so the
 * certificate can show how far the text sits below a flat distribution.
 */

const MIN_WARP = 0.6
const MAX_WARP = 3.2

export type EntropyReading = {
  shannon: number
  maxShannon: number
  distinct: number
}

export function shannonBits(s: string): EntropyReading {
  const freq = new Map<string, number>()
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1)

  const distinct = freq.size
  if (distinct === 0) return { shannon: 0, maxShannon: 0, distinct: 0 }

  const total = [...freq.values()].reduce((a, b) => a + b, 0)
  let shannon = 0
  for (const count of freq.values()) {
    const p = count / total
    shannon -= p * Math.log2(p)
  }

  return { shannon, maxShannon: Math.log2(distinct), distinct }
}

export const ENTROPY: Operator = {
  id: 'ENTROPY',
  name: 'Character entropy',
  wing: 'esoteric',
  blurb: 'Measures how many bits it costs to name the next character of the text.',
  needs: [],
  costUnits: 1,
  estMs: 2,
  estOps: 260,
  touches: ['field.warpFreq'],
  async run(ctx) {
    const { shannon, maxShannon, distinct } = shannonBits(ctx.opinion)

    const warpFreq = Math.min(MAX_WARP, Math.max(MIN_WARP, 0.6 + shannon * 0.5))

    return {
      id: 'ENTROPY',
      // One pass to tally the characters, one pass over the distinct bins.
      ops: distinct + ctx.opinion.length,
      readings: {
        shannon,
        maxShannon,
      },
      contributions: [
        {
          path: 'field.warpFreq',
          value: warpFreq,
          weight: WING_WEIGHT.esoteric * 0.7,
        },
      ],
    }
  },
}

register(ENTROPY)
