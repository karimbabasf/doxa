import { layer } from '../executor/topo'
import { allOperators, getOperator } from '../operators/registry'
import type { WorkOrder } from '../types'

export type ValidationResult = { ok: true } | { ok: false; reason: string }

/**
 * Runs before the gate screen renders, so a human never signs a plan the factory
 * cannot execute. Checks are ordered from the most specific failure to the most
 * general and the first one wins, because a reason that names one offender is
 * actionable and a list of everything wrong is not.
 */
export function validateWorkOrder(order: WorkOrder): ValidationResult {
  const known = new Set(allOperators().map(op => op.id))

  const seen = new Set<string>()
  for (const entry of order.operators) {
    if (!known.has(entry.id)) {
      return { ok: false, reason: `Operator "${entry.id}" is not in the operator library, so it cannot run.` }
    }
    if (seen.has(entry.id)) {
      return { ok: false, reason: `Operator "${entry.id}" is listed twice in the work order. It would run and be counted twice.` }
    }
    seen.add(entry.id)
  }

  const enabledIds = new Set(order.operators.filter(e => e.enabled).map(e => e.id))
  const listed = new Set(order.operators.map(e => e.id))
  for (const id of enabledIds) {
    for (const need of getOperator(id).needs) {
      if (enabledIds.has(need)) continue
      const state = listed.has(need) ? 'switched off' : 'not in the work order'
      return {
        ok: false,
        reason: `Operator "${id}" is enabled but its dependency "${need}" is ${state}. Enable "${need}" or disable "${id}".`,
      }
    }
  }

  try {
    layer([...enabledIds].map(getOperator))
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }

  if (enabledIds.size === 0) {
    return { ok: false, reason: 'A work order needs at least one enabled operator. This one has none.' }
  }

  return { ok: true }
}
