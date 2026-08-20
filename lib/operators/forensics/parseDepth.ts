import { register } from '../registry'
import { sentences } from '../../text'
import { WING_WEIGHT } from '../../types'
import type { Operator } from '../../types'

/** Words that open a subordinate clause. */
const SUBORDINATORS = ['because', 'which', 'that', 'although', 'while', 'since',
  'unless', 'whereas', 'if', 'when']

/** A comma, a semicolon, or a subordinator. Each one opens a new clause. */
const BREAK = new RegExp(`[,;]|\\b(?:${SUBORDINATORS.join('|')})\\b`, 'gi')

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export const PARSE_DEPTH: Operator = {
  id: 'PARSE-DEPTH',
  name: 'Clause break count',
  wing: 'forensics',
  blurb: 'Counts clause breaks per sentence. Not a syntax tree, a break census.',
  needs: [],
  costUnits: 1,
  estMs: 5,
  estOps: 400,
  touches: ['field.octaves'],
  async run(ctx) {
    const parts = sentences(ctx.opinion)
    let clauseCount = 0
    let deepest = 0
    let scanned = 0
    let markers = 0

    for (const sentence of parts) {
      scanned += sentence.length
      const hits = [...sentence.matchAll(BREAK)]
      markers += hits.length

      // Segments are the text between breaks, so one pass over the matches gives
      // both the clause list and the break groups.
      const segments: string[] = []
      let cursor = 0
      let groups = 0
      let previousEnd = -1
      for (const hit of hits) {
        const start = hit.index as number
        const end = start + hit[0].length
        const piece = sentence.slice(cursor, start).trim()
        if (piece.length > 0) segments.push(piece)
        // ", because" is one clause break, not two, so markers separated by
        // nothing but whitespace collapse into a single group.
        if (previousEnd < 0 || sentence.slice(previousEnd, start).trim().length > 0) groups += 1
        previousEnd = end
        cursor = end
      }
      const tail = sentence.slice(cursor).trim()
      if (tail.length > 0) segments.push(tail)

      clauseCount += segments.length
      deepest = Math.max(deepest, groups + 1)
    }

    const nestingDepth = parts.length ? deepest : 1
    const value = clamp(Math.round(2 + nestingDepth * 0.8), 2, 6)

    return {
      id: 'PARSE-DEPTH',
      // One character scanned per sentence, plus one step per break and per clause.
      ops: scanned + markers + clauseCount,
      readings: { clauseCount, nestingDepth },
      contributions: [
        { path: 'field.octaves', value, weight: WING_WEIGHT.forensics * 0.6 },
      ],
      notes: [`${parts.length} sentences, ${markers} breaks, deepest ${nestingDepth}`],
    }
  },
}

register(PARSE_DEPTH)
