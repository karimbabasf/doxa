/**
 * Kahn's algorithm over the given set only. `needs` is the DAG, so nothing else
 * defines the graph. A need that names an operator outside the set is ignored:
 * the planner is free to disable an operator, and the gate has already dropped
 * whatever depended on it. Each layer is sorted by id so a run is reproducible.
 *
 * Generic over anything carrying an id and its needs, rather than over `Operator`,
 * because the gate layers the plan too and what it holds are rows off the work
 * order with no `run` on them. The graph is the two fields below and nothing else,
 * so asking for a whole operator was asking for more than the algorithm reads.
 */
export function layer<T extends { id: string; needs: string[] }>(ops: T[]): T[][] {
  const byId = new Map<string, T>()
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

  const layers: T[][] = []
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
    layers.push(round.map(id => byId.get(id) as T))
  }
  return layers
}
