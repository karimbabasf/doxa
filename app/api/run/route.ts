import type { Database as Db } from 'better-sqlite3'
import { gateDb } from '@/app/api/plan/db'
import { getWorkOrder, insertResult, insertSpecimen, setBatchEmbedding } from '@/lib/db'
import { executeRun, type FloorEvent, type RunOpts } from '@/lib/executor/run'
import { layer } from '@/lib/executor/topo'
import { mergeContributions, type Attribution } from '@/lib/foundry/merge'
import type { Ctx, Operator, OperatorResult, RenderParams, Wing } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** One idle row on the floor, sent before anything runs so the whole line is visible first. */
export type PlanRow = {
  id: string
  name: string
  wing: Wing
  needs: string[]
  estMs: number
  estOps: number
  /** Operators sharing a layer have no dependency between them, so they run together. */
  layer: number
}

/**
 * What the floor screen reads. `FloorEvent` comes from the executor untouched; the route
 * adds the three frames the executor cannot know about: the roster at the top, the notes an
 * operator wrote while it worked, and the merged result at the end.
 */
export type StreamEvent =
  | { kind: 'plan'; batchId: string; opinion: string; concurrency: number; ops: PlanRow[] }
  | FloorEvent
  | { kind: 'note'; id: string; text: string }
  | {
      kind: 'complete'
      params: RenderParams
      attribution: Attribution
      totalOps: number
      totalMs: number
      failed: string[]
      skipped: string[]
    }

export type RunDeps = {
  db: Db
  /** Registry lookup. Injected so the route is testable without loading every operator. */
  lookup: (id: string) => Operator
  concurrency?: number
  timeoutMs?: number
  /**
   * The tracing seam. Task 15 passes its span wrapper here and it goes straight through to
   * `RunOpts.span`. The route never imports the tracer, so nothing on this path depends on
   * SigNoz being configured.
   */
  span?: RunOpts['span']
}

const DEFAULT_CONCURRENCY = 4
const DEFAULT_TIMEOUT_MS = 45_000
/** SSE comment frames, so a proxy never sits on a quiet stream during a long repair. */
const HEARTBEAT_MS = 1_000

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })

export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'The request body must be JSON of the shape { batchId }.' }, 400)
  }
  // The barrel registers every operator by importing it. Loading it here and not at module
  // scope keeps the route unit-testable while the operator library is still being written.
  const { getOperator } = await import('@/lib/operators/registry')
  await import('@/lib/operators')
  // The same handle the gate writes the signed order with, so the run reads the batch the
  // human actually signed and Next's module reloading does not leak a connection per request.
  return handleRun(body, { db: gateDb(), lookup: getOperator })
}

/**
 * Runs one signed work order and streams the floor.
 *
 * Events go out the moment the executor emits them, so what a judge watches is the run
 * itself and not a replay of it. The whole run is never buffered.
 */
export async function handleRun(body: unknown, deps: RunDeps): Promise<Response> {
  const batchId = readBatchId(body)
  if (!batchId) {
    return json({ error: 'Give a batchId. The request body must be JSON of the shape { batchId }.' }, 400)
  }

  const stored = getWorkOrder(deps.db, batchId)
  if (!stored) {
    return json({ error: `No work order exists for batch ${batchId}.` }, 404)
  }
  if (!stored.signedAt) {
    return json(
      { error: `The work order for batch ${batchId} is not signed. Sign it at the gate first.` },
      409,
    )
  }

  const enabled = stored.order.operators.filter((o) => o.enabled).map((o) => o.id)
  if (enabled.length === 0) {
    return json({ error: `The signed work order for batch ${batchId} enables no operators.` }, 409)
  }

  let ops: Operator[]
  try {
    ops = enabled.map((id) => deps.lookup(id))
  } catch (err) {
    return json({ error: messageOf(err) }, 409)
  }

  let layered: Operator[][]
  try {
    layered = layer(ops)
  } catch (err) {
    return json({ error: messageOf(err) }, 409)
  }

  const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY
  const roster = rosterOf(layered)
  const wings: Record<string, Wing> = Object.fromEntries(ops.map((o) => [o.id, o.wing]))
  const ctx: Ctx = { opinion: stored.order.opinion, batchId, results: new Map() }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      let open = true
      const send = (event: StreamEvent) => {
        if (!open) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      const heartbeat = setInterval(() => {
        if (open) controller.enqueue(encoder.encode(': ping\n\n'))
      }, HEARTBEAT_MS)

      send({
        kind: 'plan',
        batchId,
        opinion: stored.order.opinion,
        concurrency,
        ops: roster,
      })

      try {
        const run = await executeRun(ops, ctx, {
          concurrency,
          timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          span: deps.span,
          onEvent: (event) => {
            send(event)
            if (event.kind === 'done') land(deps.db, batchId, ctx.results.get(event.id), send)
          },
        })

        const results = roster.flatMap((row) => {
          const result = ctx.results.get(row.id)
          return result ? [result] : []
        })

        let merged
        try {
          merged = mergeContributions(results, { wings })
        } catch (err) {
          // No specimen. A specimen part built from defaults would misreport what was measured,
          // so the floor says which parameters nobody measured and stops there.
          send({ kind: 'fail', id: 'MERGE', ms: run.totalMs, error: messageOf(err) })
          return
        }

        insertSpecimen(deps.db, batchId, merged.params, merged.attribution)
        send({
          kind: 'complete',
          params: merged.params,
          attribution: merged.attribution,
          totalOps: run.totalOps,
          totalMs: run.totalMs,
          failed: run.failed,
          skipped: run.skipped,
        })
      } catch (err) {
        send({ kind: 'fail', id: 'RUN', ms: 0, error: messageOf(err) })
      } finally {
        clearInterval(heartbeat)
        open = false
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Tells a reverse proxy to pass every frame through instead of collecting them.
      'x-accel-buffering': 'no',
    },
  })
}

/**
 * Everything that happens when an operator lands: its result is stored, its notes go to the
 * floor, and EMBED hands over its vector. The executor treats a listener as a spectator and
 * swallows what it throws, so this catches its own trouble and reports it as a note.
 */
function land(
  db: Db,
  batchId: string,
  result: OperatorResult | undefined,
  send: (event: StreamEvent) => void,
): void {
  if (!result) return
  // EMBED parks its vector in notes[0] as JSON, since readings hold scalars only. It is the
  // one seam the similarity graph needs, and it costs a line here instead of a migration later.
  const vector = result.id === 'EMBED' ? readVector(result.notes?.[0]) : undefined
  const spoken = vector ? (result.notes ?? []).slice(1) : (result.notes ?? [])
  try {
    insertResult(db, batchId, result)
    if (vector) setBatchEmbedding(db, batchId, vector)
  } catch (err) {
    send({ kind: 'note', id: result.id, text: `not recorded: ${messageOf(err)}` })
  }
  for (const text of spoken) send({ kind: 'note', id: result.id, text })
}

function readVector(note: string | undefined): number[] | undefined {
  if (!note) return undefined
  try {
    const parsed: unknown = JSON.parse(note)
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined
    return parsed.every((n) => typeof n === 'number' && Number.isFinite(n))
      ? (parsed as number[])
      : undefined
  } catch {
    return undefined
  }
}

function rosterOf(layered: Operator[][]): PlanRow[] {
  return layered.flatMap((ops, index) =>
    ops.map((op) => ({
      id: op.id,
      name: op.name,
      wing: op.wing,
      needs: op.needs,
      estMs: op.estMs,
      estOps: op.estOps,
      layer: index,
    })),
  )
}

function readBatchId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const value = (body as { batchId?: unknown }).batchId
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
