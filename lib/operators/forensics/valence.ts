import { afinn165 } from 'afinn-165'
import { register } from '../registry'
import { words, sentences } from '../../text'
import { WING_WEIGHT } from '../../types'
import type { FieldType, Operator } from '../../types'

/**
 * AFINN-165, loaded once at module load. Word to integer valence, -5 to +5.
 * MIT, github.com/words/afinn-165.
 */
const LEXICON: Record<string, number> = afinn165

type ArcShape = 'rising' | 'falling' | 'flat'

export const VALENCE_ARC: Operator = {
  id: 'VALENCE-ARC',
  name: 'Sentiment arc',
  wing: 'forensics',
  blurb: 'Scores each sentence for feeling, then reads the shape the sentences make.',
  needs: [],
  costUnits: 1,
  estMs: 6,
  estOps: 140,
  touches: ['field.type'],
  async run(ctx) {
    const parts = sentences(ctx.opinion)
    let lookups = 0
    const scores = parts.map((sentence) => {
      const w = words(sentence)
      lookups += w.length
      if (w.length === 0) return 0
      let sum = 0
      for (const token of w) sum += LEXICON[token] ?? 0
      return sum / w.length
    })

    const netValence = scores.length
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0
    const swing = scores.length ? Math.max(...scores) - Math.min(...scores) : 0
    const drift = scores.length ? scores[scores.length - 1] - scores[0] : 0
    const arcShape: ArcShape = drift > 0.5 ? 'rising' : drift < -0.5 ? 'falling' : 'flat'

    const type: FieldType =
      netValence > 0.1 ? 'bloom' : netValence < -0.1 ? 'collapse' : 'lattice'
    const weight = WING_WEIGHT.forensics * Math.min(1, Math.abs(netValence) * 2 + 0.2)

    return {
      id: 'VALENCE-ARC',
      // One lexicon lookup per word, plus one scoring pass per sentence.
      ops: lookups + parts.length,
      readings: { netValence, arcShape, swing },
      contributions: [{ path: 'field.type', value: type, weight }],
      notes: [`sentence scores: ${scores.map((s) => s.toFixed(2)).join(', ') || 'none'}`],
    }
  },
}

register(VALENCE_ARC)
