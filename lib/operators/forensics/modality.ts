import { register } from '../registry'
import { words } from '../../text'
import { WING_WEIGHT } from '../../types'
import type { Operator } from '../../types'

type Bucket = 'must' | 'should' | 'could' | 'may'

/**
 * Seven modal phrases in four reported buckets, longest phrase first so
 * "have to" is not also read as a bare "to". Force runs 3 for an obligation
 * down to 1 for a bare possibility.
 */
const MODALS: { phrase: string; bucket: Bucket; force: number }[] = [
  { phrase: 'have to', bucket: 'must', force: 3 },
  { phrase: 'should', bucket: 'should', force: 2 },
  { phrase: 'might', bucket: 'could', force: 1 },
  { phrase: 'could', bucket: 'could', force: 1 },
  { phrase: 'ought', bucket: 'should', force: 2 },
  { phrase: 'must', bucket: 'must', force: 3 },
  { phrase: 'may', bucket: 'may', force: 1 },
]

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export const MODALITY: Operator = {
  id: 'MODALITY',
  name: 'Modal force',
  wing: 'forensics',
  blurb: 'Separates what the writer demands from what the writer merely allows.',
  needs: [],
  costUnits: 1,
  estMs: 5,
  estOps: 420,
  touches: ['frame.fill', 'dither.bias'],
  async run(ctx) {
    const tokenCount = words(ctx.opinion).length
    let remaining = ctx.opinion
    const counts: Record<Bucket, number> = { must: 0, should: 0, could: 0, may: 0 }
    let weightedSum = 0
    let total = 0

    for (const { phrase, bucket, force } of MODALS) {
      const re = new RegExp(`\\b${phrase}\\b`, 'gi')
      let hits = 0
      remaining = remaining.replace(re, (m) => {
        hits += 1
        return ' '.repeat(m.length)
      })
      counts[bucket] += hits
      weightedSum += force * hits
      total += hits
    }

    const modalForce = total === 0 ? 0 : weightedSum / (3 * total)
    const weight = WING_WEIGHT.forensics * 0.7

    return {
      id: 'MODALITY',
      // One boundary comparison per phrase per token is the work actually done.
      ops: MODALS.length * tokenCount,
      readings: { ...counts, modalForce },
      contributions: [
        { path: 'frame.fill', value: clamp(0.45 + modalForce * 0.4, 0.3, 0.92), weight },
        { path: 'dither.bias', value: (modalForce - 0.5) * 0.3, weight },
      ],
      notes: [`${total} modals, force ${modalForce.toFixed(2)}`],
    }
  },
}

register(MODALITY)
