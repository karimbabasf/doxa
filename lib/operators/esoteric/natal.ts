import { register } from '../registry'
import { words, letters } from '../../text'
import { WING_WEIGHT, type Operator } from '../../types'

/**
 * A chart is cast per word: the sum of a word's character codes modulo twelve
 * picks its sign, and the sign fixes its element and its modality. The reading
 * that matters downstream is the balance, not the label. A run whose words all
 * fall in one element gets a dark ground of that element and argues for it at
 * close to full wing weight; a run spread evenly across four elements picks the
 * same ground by a whisker and barely argues at all.
 */

export const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'] as const

export const ELEMENTS = ['fire', 'earth', 'air', 'water'] as const
export const MODALITIES = ['cardinal', 'fixed', 'mutable'] as const

export type Element = (typeof ELEMENTS)[number]
export type Modality = (typeof MODALITIES)[number]

/** Ground tone per element. All four are near black, so the ink still carries the image. */
const GROUND: Record<Element, string> = {
  fire: '#1a0f0a',
  earth: '#0f120c',
  air: '#0b1116',
  water: '#080d14',
}

/** Modality decides how the primitives are laid out, not how many there are. */
const ARRANGEMENT: Record<Modality, string> = {
  cardinal: 'radial',
  fixed: 'grid',
  mutable: 'spiral',
}

export function signOf(word: string): number {
  let sum = 0
  for (const ch of word) sum += ch.charCodeAt(0)
  return sum % 12
}

/** First index holding the largest count. Ties go to the lowest index, always. */
function argmax(counts: number[]): number {
  let best = 0
  for (let i = 1; i < counts.length; i++) if (counts[i] > counts[best]) best = i
  return best
}

export const NATAL_CHART: Operator = {
  id: 'NATAL-CHART',
  name: 'Natal chart',
  wing: 'esoteric',
  blurb: 'Casts a sign for every word from its character codes, then weighs the batch by element.',
  needs: [],
  costUnits: 1,
  estMs: 4,
  estOps: 400,
  touches: ['palette.ground', 'primitives.arrangement'],
  async run(ctx) {
    const w = words(ctx.opinion)

    const signTally = new Array<number>(12).fill(0)
    for (const word of w) signTally[signOf(word)] += 1

    const elementTally = [0, 0, 0, 0]
    const modalityTally = [0, 0, 0]
    for (let i = 0; i < 12; i++) {
      elementTally[i % 4] += signTally[i]
      modalityTally[i % 3] += signTally[i]
    }

    const total = w.length
    const share = (count: number) => (total > 0 ? count / total : 0)

    const dominantElement = ELEMENTS[argmax(elementTally)]
    const dominantModality = MODALITIES[argmax(modalityTally)]
    const elementShare = share(Math.max(...elementTally))
    const modalityShare = share(Math.max(...modalityTally))

    return {
      id: 'NATAL-CHART',
      // Twelve sign comparisons per word, plus one pass over the letters.
      ops: w.length * 12 + letters(ctx.opinion).length,
      readings: {
        dominantSign: SIGNS[argmax(signTally)],
        fire: share(elementTally[0]),
        earth: share(elementTally[1]),
        air: share(elementTally[2]),
        water: share(elementTally[3]),
        dominantModality,
      },
      contributions: [
        {
          path: 'palette.ground',
          value: GROUND[dominantElement],
          weight: WING_WEIGHT.esoteric * elementShare,
        },
        {
          path: 'primitives.arrangement',
          value: ARRANGEMENT[dominantModality],
          weight: WING_WEIGHT.esoteric * modalityShare,
        },
      ],
    }
  },
}

register(NATAL_CHART)
