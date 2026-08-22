'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlanRow, StreamEvent } from '@/app/api/run/route'
import type { GraphNode } from '@/app/api/graph/route'
import { GraphCanvas } from '@/components/graph/GraphCanvas'
import type { Wing } from '@/lib/types'
import { DitherAvatar, Sparkline } from './dither-kit'
import FloorChart from './FloorChart'
import { ValueFlash } from './interior/value-flash'

/**
 * The live factory floor.
 *
 * One row per operator, ordered by the executor's own layering, so operators sitting on the
 * same layer are drawn next to each other and light up together. That is the whole point of
 * the screen: the run is concurrent and it has to look concurrent.
 *
 * Events are applied one at a time as they arrive off the stream. Nothing is buffered and
 * nothing is replayed, so what is on screen is what the factory is doing right now.
 */

type RowState = 'idle' | 'live' | 'ok' | 'repaired' | 'failed' | 'skipped'

type Row = PlanRow & {
  state: RowState
  startedAt?: number
  ms?: number
  ops?: number
  readings?: Record<string, number | string>
  error?: string
  because?: string
  notes: string[]
}

type Complete = Extract<StreamEvent, { kind: 'complete' }>

const WING_INK: Record<Wing, string> = {
  field: 'var(--wing-field)',
  forensics: 'var(--wing-forensics)',
  semantics: 'var(--wing-semantics)',
  esoteric: 'var(--wing-esoteric)',
}

const STATE_INK: Record<RowState, string> = {
  idle: 'var(--state-idle)',
  live: 'var(--state-live)',
  ok: 'var(--state-ok)',
  repaired: 'var(--state-repair)',
  failed: 'var(--state-fail)',
  skipped: 'var(--ink-faint)',
}

const STATE_LABEL: Record<RowState, string> = {
  idle: 'IDLE',
  live: 'RUNNING',
  ok: 'OK',
  repaired: 'REPAIRED',
  failed: 'FAILED',
  skipped: 'SKIPPED',
}

const WINGS: Wing[] = ['field', 'forensics', 'semantics', 'esoteric']

export function FloorLine({ batchId }: { batchId: string }) {
  const [rows, setRows] = useState<Row[]>([])
  const [opinion, setOpinion] = useState('')
  const [concurrency, setConcurrency] = useState(0)
  const [totalOps, setTotalOps] = useState(0)
  const [summary, setSummary] = useState<Complete | null>(null)
  const [alarm, setAlarm] = useState<string | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [stoppedMs, setStoppedMs] = useState<number | null>(null)
  const [openedAt, setOpenedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  // One running total per operator that lands, in the order they landed. The shape of
  // this is the shape of the work: a flat stretch while the field wing waits on the
  // network, then a step the height of whatever came back.
  const [opsCurve, setOpsCurve] = useState<number[]>([])
  // Every opinion the factory has ever finished, fetched once this run lands. Null
  // until then, because the graph cannot include this batch before it has a specimen.
  const [graph, setGraph] = useState<GraphNode[] | null>(null)

  const alive = useRef(true)
  const started = useRef(false)

  const apply = useCallback((event: StreamEvent) => {
    if (!alive.current) return
    switch (event.kind) {
      case 'plan':
        setOpinion(event.opinion)
        setConcurrency(event.concurrency)
        setRows(event.ops.map((op) => ({ ...op, state: 'idle', notes: [] })))
        break
      case 'start':
        setOpenedAt((at) => at ?? event.at)
        setNow(Date.now())
        setRows((rs) => patch(rs, event.id, (r) => ({ ...r, state: 'live', startedAt: event.at })))
        break
      case 'done': {
        // A repair is not a plain success. The field wing reports it, and it gets its own colour.
        const repaired = String(event.readings?.repaired ?? '') === 'yes'
        setRows((rs) =>
          patch(rs, event.id, (r) => ({
            ...r,
            state: repaired ? 'repaired' : 'ok',
            ms: event.ms,
            ops: event.ops,
            readings: event.readings,
          })),
        )
        setTotalOps((n) => n + event.ops)
        setOpsCurve((curve) => [...curve, (curve[curve.length - 1] ?? 0) + event.ops])
        break
      }
      case 'fail':
        // MERGE and RUN are the floor itself failing, not an operator. They get the alarm bar.
        if (event.id === 'MERGE' || event.id === 'RUN') {
          setAlarm(event.error)
          // The run is over even though no specimen came out, so the clock stops here.
          setStoppedMs(event.ms)
          break
        }
        setRows((rs) =>
          patch(rs, event.id, (r) => ({ ...r, state: 'failed', ms: event.ms, error: event.error })),
        )
        break
      case 'skip':
        setRows((rs) =>
          patch(rs, event.id, (r) => ({ ...r, state: 'skipped', because: event.because })),
        )
        break
      case 'note':
        setRows((rs) => patch(rs, event.id, (r) => ({ ...r, notes: [...r.notes, event.text] })))
        break
      case 'complete':
        setSummary(event)
        setTotalOps(event.totalOps)
        break
    }
  }, [])

  useEffect(() => {
    // `alive` is raised on every mount, before the once-only guard. React remounts this in
    // development, and the second mount must not inherit the first one's teardown flag or the
    // floor sits there dropping every event the run sends it.
    alive.current = true
    if (!started.current) {
      started.current = true
      // The stream is never aborted on unmount. The run has to finish and write its specimen
      // even if a judge navigates away mid-batch; only the painting stops.
      void readStream(batchId, apply, (message) => {
        if (alive.current) setFatal(message)
      })
    }
    return () => {
      alive.current = false
    }
  }, [batchId, apply])

  // The run finishing is what admits this opinion to the graph, so the fetch waits
  // for the specimen rather than racing it. A failure here leaves the floor on the
  // timeline, which is a worse ending but never a broken one.
  useEffect(() => {
    if (!summary) return
    let live = true
    fetch('/api/graph')
      .then((res) => res.json())
      .then((body: { nodes?: GraphNode[] }) => {
        if (live && body.nodes) setGraph(body.nodes)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [summary])

  const liveCount = rows.filter((r) => r.state === 'live').length
  const settled = rows.filter((r) => r.state !== 'idle' && r.state !== 'live').length

  useEffect(() => {
    if (liveCount === 0) return
    const id = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(id)
  }, [liveCount])

  // A run that alarmed struck no specimen, so it never reaches the graph. It stays
  // on the timeline with its banner, which is the honest ending for it.
  const done = summary !== null && alarm === null
  const elapsed =
    summary?.totalMs ?? stoppedMs ?? (openedAt ? Math.max(0, now - openedAt) : 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header
        batchId={batchId}
        opinion={opinion}
        totalOps={totalOps}
        liveCount={liveCount}
        settled={settled}
        total={rows.length}
        concurrency={concurrency}
        elapsed={elapsed}
        rows={rows}
        opsCurve={opsCurve}
      />

      {fatal ? <Banner tone="var(--state-fail)" title="The run did not start" body={fatal} /> : null}
      {alarm ? (
        <Banner
          tone="var(--state-fail)"
          title="No specimen was struck"
          body={alarm}
        />
      ) : null}

      {/*
        Two states, one page. While the line runs, the timeline is the wait: it is
        the only thing on screen and it is worth watching, because a run with a field
        operator in it spends ninety seconds on one bar and says so without a word.

        When the specimen is struck the page stops being about this run and becomes
        about where this opinion landed. That is the payoff the whole pipeline is for,
        and it was previously three clicks away on another screen.
      */}
      {done ? (
        <FloorResult
          batchId={batchId}
          opinion={opinion}
          summary={summary}
          graph={graph}
          totalOps={totalOps}
        />
      ) : (
        <div className="flex-1 overflow-y-auto px-4 pb-16 sm:px-8">
          {rows.length === 0 && !fatal ? (
            <p className="py-10 text-ink-faint">Opening the line.</p>
          ) : null}

          <FloorChart rows={rows} openedAt={openedAt} now={now} />
        </div>
      )}
    </div>
  )
}

function Header({
  batchId,
  opinion,
  totalOps,
  liveCount,
  settled,
  total,
  concurrency,
  elapsed,
  rows,
  opsCurve,
}: {
  batchId: string
  opinion: string
  totalOps: number
  liveCount: number
  settled: number
  total: number
  concurrency: number
  elapsed: number
  rows: Row[]
  opsCurve: number[]
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-rule bg-ground-sunk/95 px-4 pt-4 pb-3 backdrop-blur sm:px-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        {/* The batch, as a mark. Seeded by the id, so one batch is always the same
            square and two batches never collide by accident. */}
        <DitherAvatar name={batchId} size={36} className="mt-[3px] shrink-0" />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-[11px] uppercase tracking-[0.26em] text-ink-dim">Floor</h1>
            <span className="text-[11px] text-ink-faint">{batchId}</span>
          </div>
          <p className="prose-sans mt-2 max-w-2xl truncate text-ink" title={opinion}>
            {opinion || 'Loading the work order.'}
          </p>
        </div>

        <div className="flex items-end gap-8">
          <div className="text-right">
            <div
              className="text-[18px] leading-none font-medium"
              style={{
                color: liveCount > 0 ? 'var(--state-live)' : 'var(--ink-dim)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {liveCount}
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-ink-faint">
              running{concurrency ? ` of ${concurrency}` : ''}
            </div>
          </div>
          <div className="text-right">
            <div
              className="text-[18px] leading-none font-medium text-ink-dim"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {secs(elapsed)}
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-ink-faint">
              elapsed
            </div>
          </div>
          {/* The work as it landed, not as it is totalled. A flat stretch here is the
              field wing waiting on the network; a step is what came back from it. */}
          {opsCurve.length > 1 ? (
            <div className="flex flex-col items-end">
              <div className="h-9 w-32">
                <Sparkline data={opsCurve} color="orange" variant="gradient" />
              </div>
              <span className="mt-1 text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                as they landed
              </span>
            </div>
          ) : null}
          <div className="flex flex-col items-end">
            <ValueFlash
              value={totalOps}
              format={(n) => n.toLocaleString('en-US')}
              className="op-flash"
            />
            <span className="mt-1 text-[10px] uppercase tracking-[0.18em] text-ink-faint">
              operations
            </span>
          </div>
        </div>
      </div>

      <Mimic rows={rows} />

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        {WINGS.map((wing) => {
          const n = rows.filter((r) => r.wing === wing).length
          if (n === 0) return null
          return (
            <span key={wing} className="flex items-center gap-2 text-[10px] tracking-[0.14em] text-ink-faint uppercase">
              <i className="block h-[2px] w-4" style={{ background: WING_INK[wing] }} />
              {wing} {n}
            </span>
          )
        })}
        <span className="ml-auto text-[10px] uppercase tracking-[0.18em] text-ink-faint" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {settled} of {total} settled
        </span>
      </div>
    </header>
  )
}

/** One cell per operator, in line order. Several cells lit at once is the concurrency, at a glance. */
function Mimic({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return null
  return (
    <div className="mt-3 flex gap-[3px]">
      {rows.map((row) => (
        <span
          key={row.id}
          title={`${row.id}: ${STATE_LABEL[row.state]}`}
          className={row.state === 'live' ? 'is-live block h-[6px] flex-1' : 'block h-[6px] flex-1'}
          style={{
            background: row.state === 'idle' ? 'var(--rule-bright)' : STATE_INK[row.state],
            opacity: row.state === 'skipped' ? 0.4 : 1,
            transition: 'background-color var(--dur-row) var(--ease-out)',
          }}
        />
      ))}
    </div>
  )
}

function FloorResult({
  batchId,
  opinion,
  summary,
  graph,
  totalOps,
}: {
  batchId: string
  opinion: string
  summary: Complete | null
  graph: GraphNode[] | null
  totalOps: number
}) {
  const [selected, setSelected] = useState<string | null>(batchId)

  const nodes = graph ?? []
  const others = Math.max(0, nodes.length - 1)
  const shown = nodes.find((n) => n.batchId === selected) ?? null

  return (
    <div className="done">
      <div className="done-head">
        <p className="done-claim">
          {graph === null
            ? 'Striking the specimen.'
            : others === 0
              ? 'The first opinion in the graph.'
              : `This opinion now sits among ${others} ${others === 1 ? 'other' : 'others'}.`}
        </p>

        <dl className="done-stats">
          <div>
            <dt>operations</dt>
            <dd>{(summary?.totalOps ?? totalOps).toLocaleString('en-US')}</dd>
          </div>
          <div>
            <dt>seconds</dt>
            <dd>{((summary?.totalMs ?? 0) / 1000).toFixed(1)}</dd>
          </div>
          <div>
            <dt>opinions</dt>
            <dd>{nodes.length}</dd>
          </div>
        </dl>
      </div>

      <div className="done-graph">
        {graph === null ? (
          <p className="done-wait">Reading the graph.</p>
        ) : (
          <GraphCanvas
            nodes={nodes}
            selectedId={selected}
            onSelect={(node) => setSelected(node?.batchId ?? null)}
            admitted={nodes.length}
          />
        )}
      </div>

      <p className="done-read">
        {shown === null
          ? 'Every node is the specimen its own run struck, and the distance between two of them is the distance between the opinions. Click any one to read it.'
          : shown.batchId === batchId
            ? `Yours: ${opinion}`
            : `${shown.opinion}`}
      </p>

      <div className="done-go">
        <a className="gate-sign" href={`/certificate/${batchId}`}>
          SEE THE CERTIFICATE
        </a>
        <Link className="done-again" href="/">
          Or put another opinion through the line
        </Link>
      </div>
    </div>
  )
}

function Banner({ tone, title, body }: { tone: string; title: string; body: string }) {
  return (
    <div className="row-in mx-4 mt-4 border-l-2 bg-ground-raised px-4 py-3 sm:mx-8" style={{ borderColor: tone }}>
      <p className="text-[11px] uppercase tracking-[0.2em]" style={{ color: tone }}>
        {title}
      </p>
      <p className="mt-1 text-[12px] text-ink-dim">{body}</p>
    </div>
  )
}
function patch(rows: Row[], id: string, fn: (row: Row) => Row): Row[] {
  return rows.map((row) => (row.id === id ? fn(row) : row))
}

function secs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

/** Reads the SSE frames off the run and hands each one to the floor as it lands. */
async function readStream(
  batchId: string,
  apply: (event: StreamEvent) => void,
  onFatal: (message: string) => void,
): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ batchId }),
    })
  } catch (err) {
    onFatal(err instanceof Error ? err.message : String(err))
    return
  }

  if (!res.ok) {
    let message = `The run route answered ${res.status}.`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // Keep the status line. A route that cannot even answer JSON has said enough.
    }
    onFatal(message)
    return
  }
  if (!res.body) {
    onFatal('The run route answered without a stream.')
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    for (;;) {
      const cut = buffer.indexOf('\n\n')
      if (cut < 0) break
      const frame = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      const line = frame.split('\n').find((l) => l.startsWith('data: '))
      if (!line) continue
      try {
        apply(JSON.parse(line.slice(6)) as StreamEvent)
      } catch {
        // One unreadable frame must not stop the floor.
      }
    }
  }
}

export default FloorLine
