import { register } from '../registry'
import { embed as embedTexts } from '../../llm'
import type { Ctx, Operator } from '../../types'

/**
 * The one vector every other semantics operator works from. It writes no render
 * path of its own: it exists so TOPIC-REL and anything downstream pay for one
 * embedding call per batch instead of one each.
 */

/**
 * Cosine similarity, the whole wing's distance measure and the one Task 12 reuses.
 *
 * A zero magnitude vector returns 0 rather than NaN, because a NaN silently poisons
 * every mean it touches downstream. A dimension mismatch throws instead: scoring the
 * overlap of two differently sized vectors returns a confident wrong number, which is
 * worse than a stopped run.
 */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: dimension mismatch, ${a.length} against ${b.length}.`)
  }
  let dot = 0
  let sumA = 0
  let sumB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    sumA += a[i] * a[i]
    sumB += b[i] * b[i]
  }
  const magnitude = Math.sqrt(sumA) * Math.sqrt(sumB)
  if (magnitude === 0) return 0
  // Floating point can overshoot on parallel vectors, and (1 - cosine) is a formula
  // in two other operators, so the range is held closed here.
  return Math.min(1, Math.max(-1, dot / magnitude))
}

/**
 * The batch vector, as a downstream operator reads it. `readings` holds scalars only,
 * so the vector travels as JSON in `notes[0]`.
 */
export function readEmbedVector(ctx: Ctx): number[] {
  const result = ctx.results.get('EMBED')
  if (!result) {
    throw new Error('EMBED has not run, so there is no batch vector to read. It belongs in `needs`.')
  }
  const raw = result.notes?.[0]
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('EMBED left no vector in notes[0].')
  }
  const vector = JSON.parse(raw) as number[]
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error('EMBED notes[0] did not parse into a vector.')
  }
  return vector
}

export const EMBED: Operator = {
  id: 'EMBED',
  name: 'Opinion embedding',
  wing: 'semantics',
  blurb: 'Turns the whole opinion into one vector the rest of the wing measures against.',
  needs: ['TOKENIZE'],
  costUnits: 3,
  estMs: 500,
  estOps: 1024,
  touches: [],
  async run(ctx) {
    const [vector] = await embedTexts([ctx.opinion])
    if (!vector || vector.length === 0) {
      throw new Error('The model API returned no embedding vector for this opinion.')
    }
    let sum = 0
    for (const value of vector) sum += value * value
    return {
      id: 'EMBED',
      // Characters read plus dimensions produced.
      ops: ctx.opinion.length + vector.length,
      readings: {
        dims: vector.length,
        norm: Math.sqrt(sum),
      },
      notes: [JSON.stringify(vector)],
    }
  },
}

register(EMBED)
