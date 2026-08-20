import { register } from '../registry'
import { letters } from '../../text'
import { WING_WEIGHT, type Operator } from '../../types'

/**
 * How hard the text sounds when it is read out. Plosives are the six stops that
 * cut the air off completely, so a line full of them lands in short hard blocks
 * and a line full of vowels runs on. That maps onto one render control cleanly:
 * a hard line gets a hard dither, meaning high contrast and few mid tones, and
 * a soft line keeps its greys.
 */

const PLOSIVES = new Set(['p', 'b', 't', 'd', 'k', 'g'])
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u'])

const MIN_CONTRAST = 0.3
const MAX_CONTRAST = 1.6

export const PHONETIC: Operator = {
  id: 'PHONETIC',
  name: 'Phonetic weight',
  wing: 'esoteric',
  blurb: 'Weighs the hard stops against the open vowels to hear how blunt the line reads.',
  needs: [],
  costUnits: 1,
  estMs: 2,
  estOps: 240,
  touches: ['dither.contrast'],
  async run(ctx) {
    const chars = letters(ctx.opinion)

    let plosiveCount = 0
    let vowelCount = 0
    let consonantCount = 0
    let ops = 0

    for (const ch of chars) {
      ops += 1
      if (PLOSIVES.has(ch)) plosiveCount += 1
      ops += 1
      if (VOWELS.has(ch)) vowelCount += 1
      else consonantCount += 1
    }

    const plosiveDensity = chars.length > 0 ? plosiveCount / chars.length : 0
    const cvRatio = consonantCount / Math.max(1, vowelCount)

    const contrast = Math.min(
      MAX_CONTRAST,
      Math.max(MIN_CONTRAST, 0.5 + plosiveDensity * 1.6),
    )

    return {
      id: 'PHONETIC',
      ops,
      readings: {
        plosiveDensity,
        cvRatio,
      },
      contributions: [
        {
          path: 'dither.contrast',
          value: contrast,
          weight: WING_WEIGHT.esoteric * 0.8,
        },
      ],
    }
  },
}

register(PHONETIC)
