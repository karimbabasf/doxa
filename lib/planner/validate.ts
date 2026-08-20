import { allOperators, getOperator } from '../operators/registry'
import type { Operator, WorkOrder } from '../types'

export type ValidationResult = { ok: true } | { ok: false; reason: string }

/**
 * Kahn's algorithm over the given set only, the same shape as `lib/executor/topo.ts`.
 * It is duplicated on purpose for now: the planner has to layer a set before the
 * executor exists in the request, and importing across those two modules while both
 * are being written would couple them at the worst moment. Unify later.
 *
 * A need that names an operator outside the set is ignored here, because
 * `validateWorkOrder` has already refused an order whose dependencies are missing.
 * Each layer is sorted by id so the same set always flattens to the same order.
 */
export function layerOps(ops: Operator[]): Operator[][] {
  const byId = new Map<string, Operator>()
  for (const op of ops) {
    if (byId.has(op.id)) {
      throw new Error(`Operator "${op.id}" appears twice in the run set. It would run and be counted twice.`)
    }
    byId.set(op.id, op)
  }

  const waitingOn = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const op of ops) {
    waitingOn.set(op.id, 0)
    dependents.set(op.id, [])
  }
  for (const op of ops) {
    for (const need of new Set(op.needs)) {
      if (!byId.has(need)) continue
      waitingOn.set(op.id, (waitingOn.get(op.id) as number) + 1)
      ;(dependents.get(need) as string[]).push(op.id)
    }
  }

  const layers: Operator[][] = []
  const placed = new Set<string>()
  while (placed.size < byId.size) {
    const round = [...byId.keys()].filter(id => !placed.has(id) && waitingOn.get(id) === 0).sort()
    if (round.length === 0) {
      const stuck = [...byId.keys()].filter(id => !placed.has(id)).sort()
      throw new Error(`Dependency cycle among operators: ${stuck.join(', ')}.`)
    }
    for (const id of round) placed.add(id)
    for (const id of round) {
      for (const dep of dependents.get(id) as string[]) {
        waitingOn.set(dep, (waitingOn.get(dep) as number) - 1)
      }
    }
    layers.push(round.map(id => byId.get(id) as Operator))
  }
  return layers
}

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
    layerOps([...enabledIds].map(getOperator))
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }

  if (enabledIds.size === 0) {
    return { ok: false, reason: 'A work order needs at least one enabled operator. This one has none.' }
  }

  return { ok: true }
}
