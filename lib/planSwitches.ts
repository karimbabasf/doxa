import { layer } from './executor/topo'

/**
 * What a switch on the gate actually does.
 *
 * Two screens carry switches now: the plain gate, where every step opens a menu of its
 * own tools, and the full graph at `?detail=1`. They have to answer the same question the
 * same way, because a person can flip a switch on one and sign on the other. So the rule
 * lives here once, next to the words in `planLanguage.ts`, and neither screen owns a copy.
 *
 * The rule: an instrument runs when nobody switched it off by hand AND every need of its
 * own is running. Deriving it rather than storing an enabled flag per card is what lets a
 * dependency come back and bring its dependents with it, while the ones a person refused
 * by hand stay off.
 */

/** Everything this file needs off an operator. Anything with an id and needs will do. */
export type Switchable = { id: string; needs: string[] }

export type Resolved = {
  on: boolean
  /** Needs that are not running, which is why this one is held back rather than refused. */
  blockedBy: string[]
}

export function resolve<T extends Switchable>(
  layers: T[][],
  off: ReadonlySet<string>,
): Map<string, Resolved> {
  const state = new Map<string, Resolved>()
  for (const group of layers) {
    for (const op of group) {
      if (off.has(op.id)) {
        state.set(op.id, { on: false, blockedBy: [] })
        continue
      }
      const blockedBy = [...new Set(op.needs)].filter(need => !state.get(need)?.on)
      state.set(op.id, { on: blockedBy.length === 0, blockedBy })
    }
  }
  return state
}

/**
 * The same answer for a caller that holds a flat list rather than layers.
 *
 * `layer()` is the one topological sort in the app, so this goes through it rather than
 * walking `needs` a second way. A cyclic order is the planner's bug and not this file's:
 * the layers fall back to the flat list, every operator reads as blocked by its own needs,
 * and the screen still draws instead of throwing under a pointer.
 */
export function resolveList<T extends Switchable>(
  operators: T[],
  off: ReadonlySet<string>,
): Map<string, Resolved> {
  let layers: T[][]
  try {
    layers = layer(operators as never) as unknown as T[][]
  } catch {
    layers = [operators]
  }
  return resolve(layers, off)
}

/** The ids to sign for, in the order the planner listed them. */
export function enabledIds<T extends Switchable>(
  operators: T[],
  state: Map<string, Resolved>,
): string[] {
  return operators.filter(op => state.get(op.id)?.on).map(op => op.id)
}

/**
 * How long the enabled half of the order takes, in the planner's own arithmetic.
 *
 * Everything inside a layer runs at once, so the wait is the sum over layers of the
 * slowest instrument still switched on, never the sum of every instrument. The footer
 * on the gate reads this rather than the number stored with the order, because a person
 * who has just switched the web off deserves to watch the wait fall.
 */
export function estimateMs<T extends Switchable & { estMs: number }>(
  operators: T[],
  state: Map<string, Resolved>,
): number {
  const on = operators.filter(op => state.get(op.id)?.on)
  if (on.length === 0) return 0
  let layers: T[][]
  try {
    layers = layer(on as never) as unknown as T[][]
  } catch {
    return on.reduce((worst, op) => Math.max(worst, op.estMs), 0)
  }
  return layers.reduce((total, group) => total + group.reduce((w, op) => Math.max(w, op.estMs), 0), 0)
}
