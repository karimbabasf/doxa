import { NextResponse } from 'next/server'
import { gateDb } from '../plan/db'
import type { RenderParams } from '@/lib/types'

/**
 * Everything the graph needs to draw itself, in one read.
 *
 * The graph is a view of runs that already happened, so this route computes nothing.
 * It hands over the embedding EMBED measured and the parameters the foundry settled on,
 * and the client turns those into a position and a specimen. If a batch never finished
 * its run it has no specimen, and it is left out rather than drawn from defaults: a node
 * on this canvas is a claim that the pipeline ran, and a placeholder would break it.
 */

export type GraphNode = {
  batchId: string
  opinion: string
  createdAt: string
  embedding: number[]
  params: RenderParams
  /** Real operations performed, summed across the run. Sets the node's radius. */
  ops: number
  /** Operators that reported, which is what the dive will draw. */
  operatorCount: number
}

type BatchRow = { id: string; opinion: string; created_at: string; embedding: string | null }
type SpecimenRow = { batch_id: string; params: string }
type OpsRow = { batch_id: string; ops: number; operators: number }

// TORN OUT 2026-08-22: this handler served the graph, which is being rebuilt. The
// exported types above stay live because the graph components still typecheck against
// them. The stub keeps the route valid and tells any caller the data is gone.

// export async function GET() {
//   const db = gateDb()
//
//   const batches = db
//     .prepare('select id, opinion, created_at, embedding from batches order by rowid asc')
//     .all() as BatchRow[]
//
//   const specimens = new Map(
//     (db.prepare('select batch_id, params from specimens').all() as SpecimenRow[]).map(
//       (row) => [row.batch_id, row.params],
//     ),
//   )
//
//   // ops lives inside each result's JSON, so the sum happens here rather than in SQL.
//   const opsRows = db
//     .prepare('select batch_id, json from results')
//     .all() as { batch_id: string; json: string }[]
//   const tally = new Map<string, OpsRow>()
//   for (const row of opsRows) {
//     const entry = tally.get(row.batch_id) ?? {
//       batch_id: row.batch_id,
//       ops: 0,
//       operators: 0,
//     }
//     try {
//       entry.ops += Number(JSON.parse(row.json).ops) || 0
//     } catch {
//       // A result that will not parse is a broken row, not a reason to lose the batch.
//     }
//     entry.operators += 1
//     tally.set(row.batch_id, entry)
//   }
//
//   const nodes: GraphNode[] = []
//   for (const batch of batches) {
//     const rawParams = specimens.get(batch.id)
//     if (!rawParams || !batch.embedding) continue
//
//     let params: RenderParams
//     let embedding: number[]
//     try {
//       params = JSON.parse(rawParams) as RenderParams
//       embedding = JSON.parse(batch.embedding) as number[]
//     } catch {
//       continue
//     }
//     if (!Array.isArray(embedding) || embedding.length === 0) continue
//
//     const counts = tally.get(batch.id)
//     nodes.push({
//       batchId: batch.id,
//       opinion: batch.opinion,
//       createdAt: batch.created_at,
//       embedding,
//       params,
//       ops: counts?.ops ?? 0,
//       operatorCount: counts?.operators ?? 0,
//     })
//   }
//
//   return NextResponse.json({ nodes })
// }
//

export async function GET() {
  return NextResponse.json({ error: 'The graph is being rebuilt.' }, { status: 503 })
}