import type { Ctx, Operator, OperatorResult } from '../types'
import { layer } from './topo'

/** What the floor screen sees. One operator produces exactly one terminal event: done, fail or skip. */
export type FloorEvent =
  | { kind: 'start'; id: string; at: number }
  | { kind: 'done'; id: string; ms: number; ops: number; readings: Record<string, number | string> }
  | { kind: 'fail'; id: string; ms: number; error: string }
  | { kind: 'skip'; id: string; because: string }

export type RunResult = {
  results: Map<string, OperatorResult>
  failed: string[]
  skipped: string[]
  totalOps: number
  totalMs: number
}

export type RunOpts = {
  concurrency: number
  timeoutMs: number
  onEvent: (e: FloorEvent) => void
  span?: <T>(name: string, attrs: Record<string, unknown>, fn: () => Promise<T>) => Promise<T>
}

/**
 * Runs the DAG that `needs` describes. Every operator starts the moment its own
 * needs have landed, so an operator is never held back by an unrelated slow one
 * in the same layer. `layer()` still runs first, for cycle detection and for the
 * stable order the pool draws from.
 *
 * An operator that throws or times out fails alone. Its dependents skip, and the
 * skip cascades. A failed operator writes nothing into `ctx.results`, so the merge
 * can never build a specimen out of a half result.
 */
export async function executeRun(ops: Operator[], ctx: Ctx, opts: RunOpts): Promise<RunResult> {
  const order = layer(ops).flat()
  const inSet = new Set(order.map(o => o.id))
  const cap = Math.max(1, Math.floor(opts.concurrency) || 1)

  const failed: string[] = []
  const skipped: string[] = []
  const failedSet = new Set<string>()
  const skippedSet = new Set<string>()
  const claimed = new Set<string>()
  const inflight = new Map<string, Promise<void>>()
  let totalOps = 0
  const startedAt = Date.now()

  const emit = (e: FloorEvent) => {
    try {
      opts.onEvent(e)
    } catch {
      // A listener is a spectator. It must never take the run down with it.
    }
  }

  const runOne = async (op: Operator): Promise<void> => {
    const at = Date.now()
    emit({ kind: 'start', id: op.id, at })
    const work = async () => {
      const result = await withTimeout(op.run(ctx), opts.timeoutMs, op.id)
      if (!result || typeof result !== 'object') {
        throw new Error(`Operator "${op.id}" resolved without a result.`)
      }
      return result
    }
    try {
      // The error is left to escape the span so a tracer can mark the span failed.
      // Task 15 supplies the real one; without it the operator just runs.
      const result = opts.span
        ? await opts.span(op.id, { wing: op.wing, needs: op.needs }, work)
        : await work()
      const count = Number.isFinite(result.ops) ? result.ops : 0
      ctx.results.set(op.id, result)
      totalOps += count
      emit({ kind: 'done', id: op.id, ms: Date.now() - at, ops: count, readings: result.readings })
    } catch (err) {
      failed.push(op.id)
      failedSet.add(op.id)
      emit({ kind: 'fail', id: op.id, ms: Date.now() - at, error: messageOf(err) })
    }
  }

  for (;;) {
    // Skips resolve first and to a fixed point, so a cascade is settled before the
    // pool looks for work. `order` is topological, so one pass carries a chain down.
    for (const op of order) {
      if (claimed.has(op.id)) continue
      const blocker = op.needs.find(n => inSet.has(n) && (failedSet.has(n) || skippedSet.has(n)))
      if (!blocker) continue
      claimed.add(op.id)
      skippedSet.add(op.id)
      skipped.push(op.id)
      emit({ kind: 'skip', id: op.id, because: `depends on ${blocker}` })
    }

    for (const op of order) {
      if (inflight.size >= cap) break
      if (claimed.has(op.id)) continue
      if (!op.needs.every(n => !inSet.has(n) || ctx.results.has(n))) continue
      claimed.add(op.id)
      const p = runOne(op).then(() => { inflight.delete(op.id) })
      inflight.set(op.id, p)
    }

    if (inflight.size === 0) break
    await Promise.race(inflight.values())
  }

  return { results: ctx.results, failed, skipped, totalOps, totalMs: Date.now() - startedAt }
}

/** Rejects at `ms` and always clears its timer, so one hung operator cannot hold the process open. */
async function withTimeout<T>(work: Promise<T>, ms: number, id: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Operator "${id}" ran past ${ms}ms and was cut.`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
