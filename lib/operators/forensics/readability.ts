import { register } from '../registry'
import { words, sentences, syllables } from '../../text'
import { WING_WEIGHT } from '../../types'
import type { Operator } from '../../types'

/** A word of three or more syllables counts as complex for Gunning Fog. */
const COMPLEX_SYLLABLES = 3

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export const FK_READ: Operator = {
  id: 'FK-READ',
  name: 'Readability grade',
  wing: 'forensics',
  blurb: 'Reads sentence length and syllable load as two school grade levels.',
  needs: [],
  costUnits: 1,
  estMs: 5,
  estOps: 200,
  touches: ['field.scale'],
  async run(ctx) {
    const w = words(ctx.opinion)
    const s = sentences(ctx.opinion)

    if (w.length === 0 || s.length === 0) {
      return {
        id: 'FK-READ',
        ops: 0,
        readings: { fleschKincaid: 0, gunningFog: 0 },
        contributions: [
          { path: 'field.scale', value: clamp(1.4, 0.35, 1.4), weight: WING_WEIGHT.forensics * 0.8 },
        ],
        notes: ['no words to grade'],
      }
    }

    const perWord = w.map(syllables)
    const syllableCount = perWord.reduce((a, b) => a + b, 0)
    const complexWords = perWord.filter((n) => n >= COMPLEX_SYLLABLES).length

    const wordsPerSentence = w.length / s.length
    const fleschKincaid = 0.39 * wordsPerSentence + 11.8 * (syllableCount / w.length) - 15.59
    const gunningFog = 0.4 * (wordsPerSentence + 100 * (complexWords / w.length))

    // Flesch-Kincaid is this operator's headline grade, so it is the one that
    // drives the scale. Gunning Fog stays a reading the certificate can show.
    const grade = fleschKincaid
    const value = clamp(1.4 - grade * 0.06, 0.35, 1.4)

    return {
      id: 'FK-READ',
      // One syllable count and one complexity check per word, one ratio per sentence.
      ops: w.length * 2 + s.length,
      readings: { fleschKincaid, gunningFog },
      contributions: [
        { path: 'field.scale', value, weight: WING_WEIGHT.forensics * 0.8 },
      ],
      notes: [`${w.length} words, ${s.length} sentences, ${complexWords} complex`],
    }
  },
}

register(FK_READ)
