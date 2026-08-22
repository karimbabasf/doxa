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
    })
  }

  return NextResponse.json({ nodes })
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
