import { describe, it, expect } from 'vitest'
import type { Database as Db } from 'better-sqlite3'
import {
  getBatch,
  getResults,
  insertBatch,
  insertWorkOrder,
  openDb,
  signWorkOrder,
} from '@/lib/db'
import type { Contribution, Operator, RenderPath, Wing, WorkOrder } from '@/lib/types'
import { handleRun, type StreamEvent } from './route'

/**
 * The floor is watched, so the route is tested on what reaches the client and in what
 * order, not only on what lands in the database.
 */

const NEVER = 5_000

/** Resolves only once `n` callers have arrived, so a serialised run fails instead of passing slowly. */
function barrier(n: number, ms = 1_000) {
  let arrived = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return async (): Promise<void> => {
    arrived += 1
    if (arrived >= n) release()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        gate,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('operators did not run at the same time')), ms)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

type FakeSpec = {
  id: string
  wing?: Wing
  needs?: string[]
  claims?: Contribution[]
  ops?: number
  notes?: string[]
  before?: () => Promise<void>
  fails?: string
}

function fake(spec: FakeSpec): Operator {
  const paths = (spec.claims ?? []).map((c) => c.path)
  return {
    id: spec.id,
    name: spec.id.toLowerCase(),
    wing: spec.wing ?? 'forensics',
    blurb: `fake ${spec.id}`,
    needs: spec.needs ?? [],
    costUnits: 1,
    estMs: 10,
    estOps: spec.ops ?? 1,
    touches: paths,
    async run() {
      if (spec.before) await spec.before()
      if (spec.fails) throw new Error(spec.fails)
      return {
        id: spec.id,
        ops: spec.ops ?? 1,
        readings: { checked: 1 },
        contributions: spec.claims,
        notes: spec.notes,
      }
    },
  }
}

const claim = (path: RenderPath, value: number | string | boolean): Contribution => ({
  path,
  value,
  weight: 1,
})

/**
 * Four operators that between them claim all seventeen render paths, so the merge has
 * nothing to complain about. SHAPE and COUNT have no needs, so they must overlap.
 */
function fullLine(extra: { before?: () => Promise<void> } = {}): Operator[] {
  return [
    fake({
      id: 'SHAPE',
      wing: 'forensics',
      ops: 120,
      before: extra.before,
      claims: [
        claim('field.type', 'bloom'),
        claim('field.scale', 4),
        claim('field.warpAmp', 0.3),
        claim('field.warpFreq', 2),
        claim('field.octaves', 3),
      ],
    }),
    fake({
      id: 'COUNT',
      wing: 'semantics',
      ops: 80,
      before: extra.before,
      claims: [
        claim('primitives.count', 24),
        claim('primitives.arrangement', 'radial'),
        claim('primitives.sizeBias', 0.6),
      ],
    }),
    fake({
      id: 'GRAIN',
      wing: 'esoteric',
      needs: ['SHAPE'],
      ops: 40,
      claims: [
        claim('dither.matrix', 4),
        claim('dither.levels', 2),
        claim('dither.contrast', 1.1),
        claim('dither.bias', 0),
      ],
    }),
    fake({
      id: 'FRAME',
      wing: 'field',
      needs: ['COUNT'],
      ops: 12,
      claims: [
        claim('palette.ink', '#e8e6e1'),
        claim('palette.ground', '#0b0b0c'),
        claim('frame.fill', 0.8),
        claim('frame.bleed', true),
        claim('seed', 7),
      ],
    }),
  ]
}

function seed(db: Db, batchId: string, ids: string[], signed: boolean): void {
  insertBatch(db, { id: batchId, opinion: 'Tabs beat spaces.', createdAt: '2026-08-21T00:00:00Z' })
  const order: WorkOrder = {
    batchId,
    opinion: 'Tabs beat spaces.',
    operators: ids.map((id) => ({ id, rationale: 'because', enabled: true })),
    estCostUnits: 4,
    estMs: 40,
    estOps: 252,
    plannerNotes: 'fixture',
    createdAt: '2026-08-21T00:00:00Z',
  }
  insertWorkOrder(db, order)
  if (signed) signWorkOrder(db, batchId, order, '2026-08-21T00:00:01Z')
}

function lookupFrom(ops: Operator[]): (id: string) => Operator {
  const byId = new Map(ops.map((o) => [o.id, o]))
  return (id) => {
    const op = byId.get(id)
    if (!op) throw new Error(`Unknown operator "${id}". It is not registered.`)
    return op
  }
}

async function collect(res: Response): Promise<StreamEvent[]> {
  const body = await res.text()
  return body
    .split('\n\n')
    .flatMap((frame) => {
      const line = frame.split('\n').find((l) => l.startsWith('data: '))
      return line ? [JSON.parse(line.slice(6)) as StreamEvent] : []
    })
}

const specimenCount = (db: Db, batchId: string): number =>
  (db.prepare('SELECT COUNT(*) AS n FROM specimens WHERE batch_id = ?').get(batchId) as { n: number })
    .n

describe('POST /api/run', () => {
  it('refuses a work order that nobody has signed', async () => {
    const db = openDb(':memory:')
    const ops = fullLine()
    seed(db, 'b-unsigned', ops.map((o) => o.id), false)

    const res = await handleRun(
      { batchId: 'b-unsigned' },
      { db, lookup: lookupFrom(ops), timeoutMs: NEVER },
    )

    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toMatch(/sign/i)
  })

  it('refuses a batch that has no work order at all', async () => {
    const db = openDb(':memory:')
    const res = await handleRun({ batchId: 'ghost' }, { db, lookup: lookupFrom([]) })
    expect(res.status).toBe(404)
  })

  it('refuses a request with no batch id', async () => {
    const db = openDb(':memory:')
    const res = await handleRun({}, { db, lookup: lookupFrom([]) })
    expect(res.status).toBe(400)
  })

  it('opens with a plan event listing every operator and its layer', async () => {
    const db = openDb(':memory:')
    const ops = fullLine()
    seed(db, 'b-plan', ops.map((o) => o.id), true)

    const events = await collect(
      await handleRun({ batchId: 'b-plan' }, { db, lookup: lookupFrom(ops), timeoutMs: NEVER }),
    )

    const first = events[0]
    expect(first.kind).toBe('plan')
    if (first.kind !== 'plan') throw new Error('expected a plan event')
    expect(first.opinion).toBe('Tabs beat spaces.')
    expect(first.ops.map((o) => o.id).sort()).toEqual(['COUNT', 'FRAME', 'GRAIN', 'SHAPE'])
    // Layer is what makes concurrency legible: same number means same moment.
    const layerOf = Object.fromEntries(first.ops.map((o) => [o.id, o.layer]))
    expect(layerOf.SHAPE).toBe(0)
    expect(layerOf.COUNT).toBe(0)
    expect(layerOf.GRAIN).toBe(1)
    expect(layerOf.FRAME).toBe(1)
    expect(first.ops.find((o) => o.id === 'FRAME')?.wing).toBe('field')
  })

  it('streams a start and a done for every operator and closes with complete', async () => {
    const db = openDb(':memory:')
    const ops = fullLine()
    seed(db, 'b-run', ops.map((o) => o.id), true)

    const res = await handleRun(
      { batchId: 'b-run' },
      { db, lookup: lookupFrom(ops), timeoutMs: NEVER },
    )
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
    const events = await collect(res)

    const started = events.filter((e) => e.kind === 'start').map((e) => e.id)
    const done = events.filter((e) => e.kind === 'done').map((e) => e.id)
    expect(started.sort()).toEqual(['COUNT', 'FRAME', 'GRAIN', 'SHAPE'])
    expect(done.sort()).toEqual(['COUNT', 'FRAME', 'GRAIN', 'SHAPE'])

    const last = events[events.length - 1]
    expect(last.kind).toBe('complete')
    if (last.kind !== 'complete') throw new Error('expected a complete event')
    expect(last.totalOps).toBe(252)
    expect(last.params.primitives.count).toBe(24)
    expect(last.attribution['field.type'].dominant).toBe('SHAPE')
    expect(last.failed).toEqual([])
    expect(last.skipped).toEqual([])
  })

  it('runs independent operators at the same time', async () => {
    const db = openDb(':memory:')
    const bothIn = barrier(2)
    const ops = fullLine({ before: bothIn })
    seed(db, 'b-concurrent', ops.map((o) => o.id), true)

    const events = await collect(
      await handleRun(
        { batchId: 'b-concurrent' },
        { db, lookup: lookupFrom(ops), concurrency: 4, timeoutMs: NEVER },
      ),
    )

    // The barrier only clears if SHAPE and COUNT were inside run() together.
    expect(events.filter((e) => e.kind === 'fail')).toEqual([])
    const order = events.filter((e) => e.kind === 'start' || e.kind === 'done').map((e) => e.kind)
    expect(order.slice(0, 2)).toEqual(['start', 'start'])
  })

  it('writes every operator result to the database', async () => {
    const db = openDb(':memory:')
    const ops = fullLine()
    seed(db, 'b-results', ops.map((o) => o.id), true)

    await collect(
      await handleRun({ batchId: 'b-results' }, { db, lookup: lookupFrom(ops), timeoutMs: NEVER }),
    )

    const stored = getResults(db, 'b-results')
    expect(stored.map((r) => r.id).sort()).toEqual(['COUNT', 'FRAME', 'GRAIN', 'SHAPE'])
    expect(stored.find((r) => r.id === 'SHAPE')?.ops).toBe(120)
  })

  it('writes the specimen once, at the end', async () => {
    const db = openDb(':memory:')
    const ops = fullLine()
    seed(db, 'b-specimen', ops.map((o) => o.id), true)

    await collect(
      await handleRun({ batchId: 'b-specimen' }, { db, lookup: lookupFrom(ops), timeoutMs: NEVER }),
    )

    expect(specimenCount(db, 'b-specimen')).toBe(1)
    const row = db
      .prepare('SELECT params, attribution FROM specimens WHERE batch_id = ?')
      .get('b-specimen') as { params: string; attribution: string }
    expect(JSON.parse(row.params).seed).toBe(7)
    expect(JSON.parse(row.attribution)['seed'].dominant).toBe('FRAME')
  })

  it('marks dependents skipped when an operator fails, and keeps running', async () => {
    const db = openDb(':memory:')
    const ops = [...fullLine()]
    ops[0] = fake({ id: 'SHAPE', wing: 'forensics', fails: 'selector renamed' })
    seed(db, 'b-fail', ops.map((o) => o.id), true)

    const events = await collect(
      await handleRun({ batchId: 'b-fail' }, { db, lookup: lookupFrom(ops), timeoutMs: NEVER }),
    )

    const failed = events.filter((e) => e.kind === 'fail')
    expect(failed.map((e) => e.id)).toContain('SHAPE')
    const skipped = events.filter((e) => e.kind === 'skip')
    expect(skipped.map((e) => e.id)).toEqual(['GRAIN'])
    if (skipped[0].kind !== 'skip') throw new Error('expected a skip event')
    expect(skipped[0].because).toMatch(/SHAPE/)
    // COUNT and FRAME are on another branch, so they still land.
    expect(events.filter((e) => e.kind === 'done').map((e) => e.id).sort()).toEqual([
      'COUNT',
      'FRAME',
    ])
  })

  it('sends a fail event naming the unset paths and writes no specimen when the merge cannot close', async () => {
    const db = openDb(':memory:')
    const ops = [...fullLine()]
    ops[0] = fake({ id: 'SHAPE', wing: 'forensics', fails: 'selector renamed' })
    seed(db, 'b-unclaimed', ops.map((o) => o.id), true)

    const events = await collect(
      await handleRun({ batchId: 'b-unclaimed' }, { db, lookup: lookupFrom(ops), timeoutMs: NEVER }),
    )

    const last = events[events.length - 1]
    expect(last.kind).toBe('fail')
    if (last.kind !== 'fail') throw new Error('expected a fail event')
    expect(last.id).toBe('MERGE')
    expect(last.error).toMatch(/field\.type/)
    expect(last.error).toMatch(/dither\.matrix/)
    expect(events.some((e) => e.kind === 'complete')).toBe(false)
    expect(specimenCount(db, 'b-unclaimed')).toBe(0)
  })

  it('stores EMBED vector on the batch when EMBED ran', async () => {
    const db = openDb(':memory:')
    const ops = [
      ...fullLine(),
      fake({ id: 'EMBED', wing: 'semantics', notes: [JSON.stringify([0.1, -0.2, 0.3])] }),
    ]
    seed(db, 'b-embed', ops.map((o) => o.id), true)

    await collect(
      await handleRun({ batchId: 'b-embed' }, { db, lookup: lookupFrom(ops), timeoutMs: NEVER }),
    )

    expect(getBatch(db, 'b-embed')?.embedding).toEqual([0.1, -0.2, 0.3])
  })

  it('leaves the batch embedding unset when EMBED did not run', async () => {
    const db = openDb(':memory:')
    const ops = fullLine()
    seed(db, 'b-no-embed', ops.map((o) => o.id), true)

    await collect(
      await handleRun({ batchId: 'b-no-embed' }, { db, lookup: lookupFrom(ops), timeoutMs: NEVER }),
    )

    expect(getBatch(db, 'b-no-embed')?.embedding).toBeUndefined()
  })

  it('forwards operator notes to the floor, so the repair story is watchable', async () => {
    const db = openDb(':memory:')
    const ops = [...fullLine()]
    ops[3] = fake({
      id: 'FRAME',
      wing: 'field',
      needs: ['COUNT'],
      ops: 12,
      notes: ['schema gate failed: title empty on every row', 'heal applied', 'verify scrape passed'],
      claims: [
        claim('palette.ink', '#e8e6e1'),
        claim('palette.ground', '#0b0b0c'),
        claim('frame.fill', 0.8),
        claim('frame.bleed', true),
        claim('seed', 7),
      ],
    })
    seed(db, 'b-notes', ops.map((o) => o.id), true)

    const events = await collect(
      await handleRun({ batchId: 'b-notes' }, { db, lookup: lookupFrom(ops), timeoutMs: NEVER }),
    )

    const notes = events.filter((e) => e.kind === 'note')
    expect(notes.map((n) => (n.kind === 'note' ? n.text : ''))).toEqual([
      'schema gate failed: title empty on every row',
      'heal applied',
      'verify scrape passed',
    ])
    expect(notes.every((n) => n.kind === 'note' && n.id === 'FRAME')).toBe(true)
  })

  it('does not read EMBED vector back out as a note', async () => {
    const db = openDb(':memory:')
    const ops = [
      ...fullLine(),
      fake({ id: 'EMBED', wing: 'semantics', notes: [JSON.stringify([0.1, 0.2]), 'model: qwen'] }),
    ]
    seed(db, 'b-embed-note', ops.map((o) => o.id), true)

    const events = await collect(
      await handleRun({ batchId: 'b-embed-note' }, { db, lookup: lookupFrom(ops), timeoutMs: NEVER }),
    )

    const texts = events.flatMap((e) => (e.kind === 'note' ? [e.text] : []))
    expect(texts).toEqual(['model: qwen'])
  })

  it('refuses a signed order that names an operator the factory does not have', async () => {
    const db = openDb(':memory:')
    const ops = fullLine()
    seed(db, 'b-unknown', ['SHAPE', 'GHOST'], true)

    const res = await handleRun(
      { batchId: 'b-unknown' },
      { db, lookup: lookupFrom(ops), timeoutMs: NEVER },
    )

    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toMatch(/GHOST/)
  })

  it('runs only the operators the signer left enabled', async () => {
    const db = openDb(':memory:')
    const ops = fullLine()
    insertBatch(db, { id: 'b-partial', opinion: 'Tabs beat spaces.', createdAt: '2026-08-21T00:00:00Z' })
    const order: WorkOrder = {
      batchId: 'b-partial',
      opinion: 'Tabs beat spaces.',
      operators: [
        { id: 'SHAPE', rationale: 'keep', enabled: true },
        { id: 'COUNT', rationale: 'keep', enabled: true },
        { id: 'GRAIN', rationale: 'keep', enabled: true },
        { id: 'FRAME', rationale: 'off', enabled: false },
      ],
      estCostUnits: 3,
      estMs: 30,
      estOps: 240,
      plannerNotes: 'fixture',
      createdAt: '2026-08-21T00:00:00Z',
    }
    insertWorkOrder(db, order)
    signWorkOrder(db, 'b-partial', order, '2026-08-21T00:00:01Z')

    const events = await collect(
      await handleRun({ batchId: 'b-partial' }, { db, lookup: lookupFrom(ops), timeoutMs: NEVER }),
    )

    const plan = events[0]
    if (plan.kind !== 'plan') throw new Error('expected a plan event')
    expect(plan.ops.map((o) => o.id).sort()).toEqual(['COUNT', 'GRAIN', 'SHAPE'])
    expect(events.some((e) => e.kind === 'start' && e.id === 'FRAME')).toBe(false)
  })
})
