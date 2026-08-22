import { NextResponse } from 'next/server'
import { gateDb } from '../plan/db'
import { faceFor, numbersOf, type Face } from '@/lib/face/plate'
import type { OperatorResult, Wing } from '@/lib/types'

/**
 * Everything the chart needs, in one read.
 *
 * The chart is a view of runs that already happened, so nothing is computed here that the
 * run did not already measure. The face comes off the readings, the position comes off the
 * embedding, and the story in the side panel is the run's own notes.
 *
 * A batch with no embedding is left out rather than placed somewhere plausible. A dot on
 * this chart is a claim that the pipeline ran and measured this text; a dot placed from a
 * default would be a lie told in the one place nobody could check it.
 */

export type ChartTool = {
  id: string
  /** The name a stranger reads. */
  name: string
  /** One sentence on what it looked at. */
  what: string
  wing: Wing
  /** Real operations performed. */
  ops: number
  /** Set when this tool broke and fixed itself, holding what it did about it. */
  healed?: string
}

/**
 * The numbers the chart can arrange by, all read off what the run measured.
 *
 * One value per axis, already on a fixed scale, because the scale is a claim: an opinion
 * that is mildly positive must not fill the happy end of the screen just because it happens
 * to be the happiest one in the set that day.
 */
export type ChartSort = {
  /** How it feels, from -1 hostile to 1 warm. */
  feeling: number
  /** How sure it sounds, from 0 hedged to 1 flat certain. */
  certainty: number
  /** When it was put through, in milliseconds. */
  time: number
}

export type ChartNode = {
  id: string
  opinion: string
  /** ISO, formatted on the client so the server never guesses a timezone. */
  createdAt: string
  embedding: number[]
  face: Face
  tools: ChartTool[]
  /** Tools the plan asked for that never reported. */
  missing: string[]
  /** Real operations performed, summed across the run. */
  ops: number
  sort: ChartSort
}

type BatchRow = { id: string; opinion: string; created_at: string; embedding: string | null }
type ResultRow = { batch_id: string; operator_id: string; json: string }
type OrderRow = { batch_id: string; json: string }

export async function GET() {
  const db = gateDb()

  // The registry is what turns an id into a name and a wing. Imported here rather than at
  // module scope so the route stays cheap when the chart is not being looked at.
  const { getOperator } = await import('@/lib/operators/registry')
  await import('@/lib/operators')
  const { plainName, plainWhat } = await import('@/lib/planLanguage')

  const batches = db
    .prepare('select id, opinion, created_at, embedding from batches order by rowid asc')
    .all() as BatchRow[]

  // One row per tool, not one per attempt.
  //
  // The results table is an append log, so a batch that was run twice holds two rows for
  // every tool. Left alone the panel listed "Reading level" three times and the face was
  // struck from the same measurement counted three times over. Keyed by tool id with the
  // newest winning: a re-run is a correction, not a second opinion.
  const resultsByBatch = new Map<string, Map<string, OperatorResult>>()
  for (const row of db
    .prepare('select batch_id, operator_id, json from results order by seq asc')
    .all() as ResultRow[]) {
    const byId = resultsByBatch.get(row.batch_id) ?? new Map<string, OperatorResult>()
    try {
      byId.set(row.operator_id, JSON.parse(row.json) as OperatorResult)
    } catch {
      // A result that will not parse is a broken row, not a reason to lose the batch.
    }
    resultsByBatch.set(row.batch_id, byId)
  }

  const plannedByBatch = new Map<string, string[]>()
  for (const row of db
    .prepare('select batch_id, json from work_orders')
    .all() as OrderRow[]) {
    try {
      const order = JSON.parse(row.json) as { operators?: { id: string; enabled: boolean }[] }
      plannedByBatch.set(
        row.batch_id,
        (order.operators ?? []).filter((o) => o.enabled).map((o) => o.id),
      )
    } catch {
      // Same reason as above.
    }
  }

  const nodes: ChartNode[] = []
  for (const batch of batches) {
    if (!batch.embedding) continue

    let embedding: number[]
    try {
      embedding = JSON.parse(batch.embedding) as number[]
    } catch {
      continue
    }
    if (!Array.isArray(embedding) || embedding.length === 0) continue

    const results = [...(resultsByBatch.get(batch.id)?.values() ?? [])]
    if (results.length === 0) continue

    const tools: ChartTool[] = results.map((result) => {
      // The planner is a language model, so it can name an operator that does not exist.
      // A chart that throws on one bad name would lose every other run on the screen.
      let name = result.id
      let wing: Wing = 'forensics'
      let blurb = ''
      try {
        const op = getOperator(result.id)
        name = op.name
        wing = op.wing
        blurb = op.blurb
      } catch {
        // Left as the id, which is still true.
      }
      return {
        id: result.id,
        name: plainName(result.id, name),
        what: plainWhat(result.id, blurb),
        wing,
        ops: Number.isFinite(result.ops) ? result.ops : 0,
        healed: healNote(result),
      }
    })

    const reported = new Set(results.map((r) => r.id))
    const missing = (plannedByBatch.get(batch.id) ?? [])
      .filter((id) => !reported.has(id))
      .map((id) => plainName(id, id))

    nodes.push({
      id: batch.id,
      opinion: batch.opinion,
      createdAt: batch.created_at,
      embedding,
      face: faceFor({ numbers: numbersOf(results), tools: results.length }),
      tools,
      missing,
      ops: tools.reduce((sum, t) => sum + t.ops, 0),
      sort: {
        feeling: feelingOf(results),
        certainty: certaintyOf(results),
        time: Date.parse(batch.created_at) || 0,
      },
    })
  }

  return NextResponse.json({ nodes })
}

/** The reading a tool wrote under one key, when it wrote a number there. */
function reading(results: OperatorResult[], id: string, key: string): number | undefined {
  const value = results.find((r) => r.id === id)?.readings?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value))

/**
 * How the opinion feels, from -1 hostile to 1 warm.
 *
 * Two tools measured this and they measure different things: the mood of the words as they
 * run past, and which side the sentence takes. Averaged where both reported, because either
 * alone is thin. Zero when neither ran, which puts the opinion in the middle, where an
 * opinion nobody measured belongs.
 */
function feelingOf(results: OperatorResult[]): number {
  const parts: number[] = []

  const valence = reading(results, 'VALENCE-ARC', 'netValence')
  if (valence !== undefined) parts.push(clamp(valence, -1, 1))

  const side = results.find((r) => r.id === 'STANCE')?.readings
  const confidence = typeof side?.confidence === 'number' ? clamp(side.confidence, 0, 1) : 0.5
  if (side?.stance === 'for') parts.push(confidence)
  else if (side?.stance === 'against') parts.push(-confidence)
  else if (side?.stance) parts.push(0)

  if (parts.length === 0) return 0
  return parts.reduce((sum, p) => sum + p, 0) / parts.length
}

/**
 * How sure the opinion sounds, from 0 hedged to 1 flat certain.
 *
 * One reading leads and the other two adjust it. Averaging all three was tried first and it
 * pushed every opinion into the middle of the screen: most sentences use no hedges and no
 * modal verbs, so those two readings are zero for nearly everybody and an average with two
 * constants in it is mostly a constant. The stance tool's own confidence is the reading that
 * actually varies, so it sets the place and the other two move it a little.
 */
function certaintyOf(results: OperatorResult[]): number {
  const confidence = reading(results, 'STANCE', 'confidence')
  if (confidence === undefined) return 0.5

  // Conviction is a count of softeners against boosters, so it has no natural top. Folded
  // onto the scale at five of either, which is a lot of hedging for one sentence.
  const conviction = reading(results, 'HEDGE-7', 'netConviction') ?? 0
  const modal = reading(results, 'MODALITY', 'modalForce') ?? 0

  return clamp(
    clamp(confidence, 0, 1) + clamp(conviction / 5, -1, 1) * 0.15 + clamp(modal, 0, 1) * 0.15,
    0,
    1,
  )
}

/**
 * What a tool did about its own failure, if anything.
 *
 * A field operator that hit a broken page records `repaired: 'yes'` and writes the story to
 * its notes. Both halves matter on the chart: the claim on its own reads as marketing, and
 * the note on its own reads as an error nobody dealt with.
 */
function healNote(result: OperatorResult): string | undefined {
  if (result.readings?.repaired !== 'yes') return undefined
  const note = (result.notes ?? []).find((n) => /heal|repair|fix|retry/i.test(n))
  return note ?? 'The page it reads had changed, so it fixed its own reader and read it again.'
}
