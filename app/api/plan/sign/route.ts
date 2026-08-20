import '@/lib/operators'
import { getWorkOrder, signWorkOrder } from '@/lib/db'
import { validateWorkOrder } from '@/lib/planner/validate'
import type { WorkOrder } from '@/lib/types'
import { gateDb } from '../db'

/**
 * The signature. Everything the human switched off is written back onto the order
 * before the stamp, so the signed row is the plan of record: what ran, and what a
 * person refused. Operators that were switched off stay listed, because an order
 * that quietly forgets them cannot answer "why was the field wing skipped".
 *
 * The refusal reasons come from `validateWorkOrder`, which already names one
 * offender and what to do about it. The floor never has to discover a broken plan.
 */

function bad(error: string, status = 400): Response {
  return Response.json({ error }, { status })
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return bad('The request body is not JSON. Send {"batchId": "...", "enabledIds": [...]}.')
  }

  const { batchId, enabledIds } = (body ?? {}) as { batchId?: unknown; enabledIds?: unknown }
  if (typeof batchId !== 'string' || !batchId) {
    return bad('Send a batchId string. It is the batch this signature applies to.')
  }
  if (!Array.isArray(enabledIds) || enabledIds.some(id => typeof id !== 'string')) {
    return bad('Send enabledIds as an array of operator ids, even if it is empty.')
  }

  const db = gateDb()
  const row = getWorkOrder(db, batchId)
  if (!row) {
    return bad(`No work order exists for batch "${batchId}", so there is nothing to sign.`, 404)
  }

  const listed = new Set(row.order.operators.map(entry => entry.id))
  const stray = (enabledIds as string[]).find(id => !listed.has(id))
  if (stray) {
    return bad(`Operator "${stray}" is not on this work order, so it cannot be enabled on it.`)
  }

  const wanted = new Set(enabledIds as string[])
  const signed: WorkOrder = {
    ...row.order,
    operators: row.order.operators.map(entry => ({ ...entry, enabled: wanted.has(entry.id) })),
  }

  const check = validateWorkOrder(signed)
  if (!check.ok) return bad(check.reason)

  const signedAt = new Date().toISOString()
  signWorkOrder(db, batchId, signed, signedAt)

  return Response.json({ ok: true, batchId, signedAt, enabledIds: [...wanted] })
}
