import type { Operator } from '../types'

const registry = new Map<string, Operator>()

export function register(op: Operator): void {
  if (registry.has(op.id)) {
    throw new Error(`Operator "${op.id}" is already registered. Ids must be unique.`)
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
