import type { Operator } from '../types'

const registry = new Map<string, Operator>()

/**
 * Everything about an operator that defines the capability, minus `run`, whose function
 * identity changes every time a module is evaluated and so says nothing about sameness.
 */
function signature(op: Operator): string {
  return [
    op.id,
    op.wing,
    op.costUnits,
    op.estMs,
    op.estOps,
    [...op.needs].sort().join('+'),
    [...op.touches].sort().join('+'),
  ].join('|')
}

/**
 * Registering the same id twice is only a bug when the two are different capabilities.
 *
 * Next evaluates a server component's module graph more than once, and every operator
 * file calls this for itself at import time, so the second pass re-registers all twenty
 * one. That is a re-evaluation, not a clash, and throwing on it took the gate screen down
 * with a 500. So an identical signature is tolerated and the newer object wins, while two
 * genuinely different operators sharing an id still throw: that one is a real collision
 * and it must not be silently resolved in favour of whichever imported last.
 */
export function register(op: Operator): void {
  const existing = registry.get(op.id)
  if (existing && signature(existing) !== signature(op)) {
    throw new Error(
      `Operator "${op.id}" is already registered as a different operator. Ids must be unique.`,
    )
  }
  registry.set(op.id, op)
}

export function getOperator(id: string): Operator {
  const op = registry.get(id)
  if (!op) throw new Error(`Unknown operator "${id}". It is not registered.`)
  return op
}

export function allOperators(): Operator[] {
  return [...registry.values()]
}

/** Tests only. Production code registers once at import time and never clears. */
export function clearRegistry(): void {
  registry.clear()
}

/**
 * Walks `needs` breadth-first and returns the deduplicated closure, including the
 * requested ids. Throws naming any id that is not registered, because a plan that
 * references a capability the factory does not have should fail before the gate,
 * not halfway through a run.
 */
export function resolveDeps(ids: string[]): string[] {
  const seen = new Set<string>()
  const queue = [...ids]
  while (queue.length) {
    const id = queue.shift() as string
    if (seen.has(id)) continue
    const op = registry.get(id)
    if (!op) throw new Error(`Cannot resolve dependencies: operator "${id}" is not registered.`)
    seen.add(id)
    for (const need of op.needs) if (!seen.has(need)) queue.push(need)
  }
  return [...seen]
}
