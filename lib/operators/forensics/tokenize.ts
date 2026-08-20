import { register } from '../registry'
import { words, sentences } from '../../text'
import type { Operator } from '../../types'

export const TOKENIZE: Operator = {
  id: 'TOKENIZE',
  name: 'Token and sentence census',
  wing: 'forensics',
  blurb: 'Counts what there is to work with before anything else reads it.',
  needs: [],
  costUnits: 1,
  estMs: 5,
  estOps: 40,
  touches: [],
  async run(ctx) {
    const w = words(ctx.opinion)
    const s = sentences(ctx.opinion)
    const unique = new Set(w).size
    return {
      id: 'TOKENIZE',
      ops: w.length + s.length + ctx.opinion.length,
      readings: {
        tokenCount: w.length,
        sentenceCount: s.length,
        avgWordLength: w.length ? w.join('').length / w.length : 0,
        uniqueRatio: w.length ? unique / w.length : 0,
      },
      notes: [w.join(', ')],
    }
  },
}

register(TOKENIZE)
