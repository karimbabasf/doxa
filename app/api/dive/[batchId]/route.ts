import { NextResponse } from 'next/server'
import { gateDb } from '../../plan/db'
import { getOperator } from '@/lib/operators'
import { layerOps } from '@/lib/planner/validate'
import type { Contribution, Evidence, OperatorResult, RenderParams, WorkOrder, Wing } from '@/lib/types'

/**
 * One opinion's whole pipeline, laid out for the dive.
 *
 * The dive's claim is that this exact node was produced by this exact run, so every field
 * below is read back from what the run wrote. The layering is the planner's own `layerOps`
 * rather than a second walker written for the screen: two DAG builders would eventually
 * disagree, and the one on screen would be the one lying.
 */

export type DiveOperator = {
  id: string
  wing: Wing
  rationale: string
  ops: number
  readings: Record<string, number | string>
  contributions: Contribution[]
  evidence: Evidence[]
  notes: string[]
  /** Operator ids this one consumed, straight off the registry. Draws the edges. */
  needs: string[]
}

export type DivePayload = {
  batchId: string
  opinion: string
  createdAt: string
  signedAt: string | null
  plannerNotes: string
  params: RenderParams
  attribution: Record<string, unknown>
  totalOps: number
  /** Operators grouped into the layers the floor actually ran them in. */
  layers: DiveOperator[][]
  /**
   * Operators the human signed that produced no result.
   *
   * The executor fails an operator alone and lets the rest of the run finish, which is
   * the right call: one dead scrape should not throw away 17 good readings. But it means
   * a finished specimen can be missing a whole wing, and a screen that only draws what
   * reported would show that run as complete. A field operator dropping out is exactly
   * the failure worth seeing, so the gap between signed and reported is carried here and
   * stated on the page.
   */
  notRun: { id: string; wing: Wing }[]
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const { batchId } = await params
  const db = gateDb()

  const batch = db
    .prepare('select id, opinion, created_at from batches where id = ?')
    .get(batchId) as { id: string; opinion: string; created_at: string } | undefined
  if (!batch) {
    return NextResponse.json({ error: `no batch ${batchId}` }, { status: 404 })
  }

  const orderRow = db
    .prepare('select json, signed_at from work_orders where batch_id = ?')
    .get(batchId) as { json: string; signed_at: string | null } | undefined
  const specimenRow = db
    .prepare('select params, attribution from specimens where batch_id = ?')
    .get(batchId) as { params: string; attribution: string } | undefined

  if (!orderRow || !specimenRow) {
    return NextResponse.json(
      { error: `batch ${batchId} has no finished run to open` },
      { status: 409 },
    )
  }

  const order = JSON.parse(orderRow.json) as WorkOrder
  const rationale = new Map(order.operators.map((o) => [o.id, o.rationale]))

  const resultRows = db
    .prepare('select operator_id, json from results where batch_id = ? order by seq asc')
    .all(batchId) as { operator_id: string; json: string }[]

  const byId = new Map<string, DiveOperator>()
  let totalOps = 0

  for (const row of resultRows) {
    let result: OperatorResult
    try {
      result = JSON.parse(row.json) as OperatorResult
    } catch {
      continue
    }
    // An operator that ran but is no longer in the registry still has a real reading,
    // so it keeps its card and simply reports no dependencies.
    let wing: Wing = 'forensics'
    let needs: string[] = []
    try {
      const op = getOperator(row.operator_id)
      wing = op.wing
      needs = op.needs
    } catch {
      // Left at the defaults above.
    }

    totalOps += result.ops ?? 0
    byId.set(row.operator_id, {
      id: row.operator_id,
      wing,
      rationale: rationale.get(row.operator_id) ?? '',
      ops: result.ops ?? 0,
      readings: result.readings ?? {},
      contributions: result.contributions ?? [],
      evidence: result.evidence ?? [],
      notes: result.notes ?? [],
      needs,
    })
  }

  // Layer with the planner's own walker, over just the operators that reported. An
  // operator that never ran must not open a layer the floor never had.
  const ran = [...byId.keys()]
  let layers: DiveOperator[][]
  try {
    layers = layerOps(ran.map(getOperator)).map((layer) =>
      layer.map((op) => byId.get(op.id)).filter((op): op is DiveOperator => !!op),
    )
  } catch {
    // Registry drift beats the walker. One layer still tells the truth about what ran.
    layers = [ran.map((id) => byId.get(id)).filter((op): op is DiveOperator => !!op)]
  }

  // Signed and enabled, but nothing came back. Read off the work order rather than the
  // registry, so it names what this run was actually asked to do.
  const notRun = order.operators
    .filter((o) => o.enabled && !byId.has(o.id))
    .map((o) => {
      let wing: Wing = 'forensics'
      try {
        wing = getOperator(o.id).wing
      } catch {
        // An operator no longer in the registry still belongs in the count.
      }
      return { id: o.id, wing }
    })

  const payload: DivePayload = {
    batchId: batch.id,
    notRun,
    opinion: batch.opinion,
    createdAt: batch.created_at,
    signedAt: orderRow.signed_at,
    plannerNotes: order.plannerNotes ?? '',
    params: JSON.parse(specimenRow.params) as RenderParams,
    attribution: JSON.parse(specimenRow.attribution) as Record<string, unknown>,
    totalOps,
    layers: layers.filter((layer) => layer.length > 0),
  }

  return NextResponse.json(payload)
}
