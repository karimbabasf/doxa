import { register } from '../registry'
import { letters } from '../../text'
import { WING_WEIGHT, type Operator } from '../../types'

/**
 * The oldest trick in the book: every letter carries a number, the numbers add
 * up, and the total folds down to a single digit. The fold is what makes it
 * usable here. The raw sum grows without bound with the length of the opinion,
 * so it would only ever say "this text is long"; the digital root says nothing
 * about length at all, which is why it sets the primitive count and the raw sum
 * only nudges it.
 */

const MIN_COUNT = 3
const MAX_COUNT = 24

/** a is 1 through z is 26. Anything else was already dropped by `letters`. */
export function letterValue(ch: string): number {
  return ch.charCodeAt(0) - 96
}

/** Repeated digit sum, in closed form. Zero stays zero, everything else lands in 1 to 9. */
export function digitalRoot(sum: number): number {
  return sum === 0 ? 0 : 1 + ((sum - 1) % 9)
}

export const GEMATRIA: Operator = {
  id: 'GEMATRIA',
  name: 'Gematria',
  wing: 'esoteric',
  blurb: 'Adds the letters up by their old numbers and folds the total down to one digit.',
  needs: [],
  costUnits: 1,
  estMs: 2,
  estOps: 200,
  touches: ['primitives.count'],
  async run(ctx) {
    const chars = letters(ctx.opinion)

    let letterSum = 0
    for (const ch of chars) letterSum += letterValue(ch)
    const root = digitalRoot(letterSum)

    const raw = MIN_COUNT + root * 2 + (letterSum % 5)
    const count = Math.min(MAX_COUNT, Math.max(MIN_COUNT, raw))

    return {
      id: 'GEMATRIA',
      ops: chars.length,
      readings: {
        letterSum,
        digitalRoot: root,
      },
      contributions: [
        {
          path: 'primitives.count',
          value: count,
          weight: WING_WEIGHT.esoteric * 0.9,
        },
      ],
    }
  },
}

register(GEMATRIA)
