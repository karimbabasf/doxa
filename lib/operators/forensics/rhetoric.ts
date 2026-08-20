import { register } from '../registry'
import { words } from '../../text'
import { WING_WEIGHT } from '../../types'
import type { Arrangement, Operator } from '../../types'

type Device = 'analogy' | 'hyperbole' | 'authority' | 'falseDilemma'

/** Words that end in "est" without being a superlative. */
const NOT_SUPERLATIVE = new Set(['best', 'west', 'rest', 'test', 'interest'])

/**
 * Patterns per device, broadest first inside each device so one figure of speech
 * scores once. "You are either with us or against us" is one false dilemma, not
 * two, so the wider pattern claims the span before the narrower one sees it.
 */
const PATTERNS: { device: Device; re: RegExp; stoplist?: Set<string> }[] = [
  { device: 'analogy', re: /\bmight as well be\b/gi },
  { device: 'analogy', re: /\bis basically\b/gi },
  { device: 'analogy', re: /\bis just\b/gi },
  { device: 'analogy', re: /\blike a\b/gi },
  { device: 'analogy', re: /\bas if\b/gi },
  { device: 'hyperbole', re: /\bsingle worst\b/gi },
  { device: 'hyperbole', re: /\bsingle best\b/gi },
  { device: 'hyperbole', re: /\bby far\b/gi },
  { device: 'hyperbole', re: /\b\w+est\b/gi, stoplist: NOT_SUPERLATIVE },
  { device: 'hyperbole', re: /\bever\b/gi },
  { device: 'authority', re: /\bit is well known\b/gi },
  { device: 'authority', re: /\bstudies show\b/gi },
  { device: 'authority', re: /\bresearch says\b/gi },
  { device: 'authority', re: /\bexperts agree\b/gi },
  { device: 'authority', re: /\beveryone knows\b/gi },
  { device: 'falseDilemma', re: /\beither .{0,40} or\b/gi },
  { device: 'falseDilemma', re: /\bthere are only two\b/gi },
  { device: 'falseDilemma', re: /\byou are either\b/gi },
]

/** Device order is also the tie break, so the winner never depends on iteration luck. */
const DEVICES: { device: Device; arrangement: Arrangement }[] = [
  { device: 'analogy', arrangement: 'spiral' },
  { device: 'hyperbole', arrangement: 'radial' },
  { device: 'authority', arrangement: 'grid' },
  { device: 'falseDilemma', arrangement: 'scatter' },
]

export const RHETORIC: Operator = {
  id: 'RHETORIC',
  name: 'Rhetorical device census',
  wing: 'forensics',
  blurb: 'Looks for the four moves an argument makes when it stops arguing.',
  needs: [],
  costUnits: 1,
  estMs: 6,
  estOps: 1100,
  touches: ['primitives.arrangement'],
  async run(ctx) {
    const tokenCount = words(ctx.opinion).length
    let remaining = ctx.opinion
    const counts: Record<Device, number> = {
      analogy: 0, hyperbole: 0, authority: 0, falseDilemma: 0,
    }

    for (const { device, re, stoplist } of PATTERNS) {
      remaining = remaining.replace(re, (m) => {
        if (stoplist?.has(m.toLowerCase())) return m
        counts[device] += 1
        return ' '.repeat(m.length)
      })
    }

    const totalHits = DEVICES.reduce((sum, d) => sum + counts[d.device], 0)
    let winner = DEVICES[0]
    for (const d of DEVICES) if (counts[d.device] > counts[winner.device]) winner = d
    const value: Arrangement = totalHits === 0 ? 'grid' : winner.arrangement
    const weight = WING_WEIGHT.forensics * Math.min(1, totalHits * 0.35 + 0.2)

    return {
      id: 'RHETORIC',
      // One boundary comparison per pattern per token is the work actually done.
      ops: PATTERNS.length * tokenCount,
      readings: { ...counts },
      contributions: [{ path: 'primitives.arrangement', value, weight }],
      notes: [`${totalHits} devices, arrangement ${value}`],
    }
  },
}

register(RHETORIC)
