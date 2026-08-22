'use client'

import { useMemo } from 'react'
import type { Wing } from '@/lib/types'
import { OpCounter } from './OpCounter'
import { useFloorRun, type Complete, type Row, type RowState } from './useFloorRun'

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

/** Stagger caps at ten steps. Past that the last row waits on the animation, not the factory. */
const STAGGER_MS = 40
const STAGGER_CAP = 10

export function FloorLine({ batchId }: { batchId: string }) {
  const {
    rows,
    opinion,
    concurrency,
    totalOps,
    summary,
    alarm,
    fatal,
    now,
    liveCount,
    settled,
    elapsed,
  } = useFloorRun(batchId)

  const layers = useMemo(() => groupByLayer(rows), [rows])

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
      />

      {fatal ? <Banner tone="var(--state-fail)" title="The run did not start" body={fatal} /> : null}
      {alarm ? (
        <Banner
          tone="var(--state-fail)"
          title="No specimen was struck"
          body={alarm}
        />
      ) : null}

      <div className="flex-1 overflow-y-auto px-4 pb-16 sm:px-8">
        {rows.length === 0 && !fatal ? (
          <p className="py-10 text-ink-faint">Opening the line.</p>
        ) : null}

        {layers.map(({ layer, rows: group }, layerIndex) => (
          <section key={layer} className="mt-6 first:mt-4">
            <div className="flex items-baseline gap-3 border-b border-rule pb-1">
              <span className="text-[10px] uppercase tracking-[0.22em] text-ink-faint">
                Layer {layer + 1}
              </span>
              <span className="text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                {group.length === 1
                  ? '1 operator'
                  : `${group.length} operators, nothing between them`}
              </span>
            </div>
            <ul>
              {group.map((row, i) => (
                <LineRow
                  key={row.id}
                  row={row}
                  now={now}
                  delayMs={Math.min(layerIndex * 3 + i, STAGGER_CAP) * STAGGER_MS}
                />
              ))}
            </ul>
          </section>
        ))}

        {summary ? <Result summary={summary} /> : null}
      </div>
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
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-rule bg-ground-sunk/95 px-4 pt-4 pb-3 backdrop-blur sm:px-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
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
          <OpCounter value={totalOps} />
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

function LineRow({ row, now, delayMs }: { row: Row; now: number; delayMs: number }) {
  const live = row.state === 'live'
  const runningMs = live && row.startedAt ? Math.max(0, now - row.startedAt) : undefined
  const overEstimate = runningMs !== undefined && runningMs > row.estMs * 1.4

  return (
    <li
      className="row-in grid grid-cols-[3px_minmax(0,1fr)] gap-x-3 border-b border-rule py-2 sm:grid-cols-[3px_190px_104px_112px_minmax(0,1fr)] sm:items-baseline"
      style={{
        animationDelay: `${delayMs}ms`,
        background: live ? 'color-mix(in srgb, var(--state-live) 6%, transparent)' : 'transparent',
        transition: 'background-color var(--dur-row) var(--ease-out)',
      }}
    >
      <i
        className="row-span-2 block h-full w-[3px] sm:row-span-1"
        style={{
          background: WING_INK[row.wing],
          opacity: row.state === 'idle' ? 0.35 : row.state === 'skipped' ? 0.2 : 1,
          transition: 'opacity var(--dur-row) var(--ease-out)',
        }}
      />

      <div className="flex min-w-0 items-baseline gap-2 overflow-hidden">
        <span
          className="whitespace-nowrap text-ink"
          style={{ opacity: row.state === 'idle' || row.state === 'skipped' ? 0.55 : 1 }}
        >
          {row.id}
        </span>
        <span className="min-w-0 truncate text-ink-faint">{row.name}</span>
      </div>

      <div
        className="hidden whitespace-nowrap text-[11px] uppercase tracking-[0.14em] sm:block"
        style={{ color: WING_INK[row.wing] }}
      >
        {row.wing}
      </div>

      <div className="flex items-center gap-2">
        <i
          key={row.state}
          className={live ? 'is-live block h-[7px] w-[7px] rounded-full' : 'block h-[7px] w-[7px] rounded-full'}
          style={{ background: STATE_INK[row.state] }}
        />
        <span
          key={`${row.state}-label`}
          className="row-in text-[11px] tracking-[0.14em]"
          style={{ color: STATE_INK[row.state] }}
        >
          {STATE_LABEL[row.state]}
        </span>
      </div>

      <div className="col-start-2 min-w-0 sm:col-start-5">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {runningMs !== undefined ? (
            <span
              className="text-[12px]"
              style={{ color: 'var(--state-live)', fontVariantNumeric: 'tabular-nums' }}
            >
              t+{(runningMs / 1000).toFixed(1)}s
            </span>
          ) : null}
          {row.ms !== undefined ? (
            <span className="text-[12px] text-ink-dim" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {took(row.ms)}
            </span>
          ) : null}
          {live ? (
            <span className="text-[11px] text-ink-faint" style={{ fontVariantNumeric: 'tabular-nums' }}>
              est {(row.estMs / 1000).toFixed(1)}s{overEstimate ? ', over estimate' : ''}
            </span>
          ) : null}
          {row.ops !== undefined ? (
            <span className="text-[11px] text-ink-faint" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {row.ops.toLocaleString('en-US')} ops
            </span>
          ) : null}
          {row.state === 'idle' ? (
            <span className="text-[11px] text-ink-faint">waiting for its inputs</span>
          ) : null}
          {row.readings
            ? Object.entries(row.readings).map(([key, value]) => (
                <span key={key} className="text-[11px] text-ink-dim">
                  <span className="text-ink-faint">{key}</span>{' '}
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{reading(value)}</span>
                </span>
              ))
            : null}
        </div>

        {row.error ? (
          <p className="row-in mt-1 text-[12px]" style={{ color: 'var(--state-fail)' }}>
            {row.error}
          </p>
        ) : null}
        {row.because ? (
          <p className="row-in mt-1 text-[12px] text-ink-faint">
            not run, {row.because}
          </p>
        ) : null}
        {row.notes.length > 0 ? (
          // Repair colour is reserved for a row that actually repaired itself, so the heal
          // story stands out from the ordinary working notes every operator writes.
          <ul
            className="mt-1 border-l pl-3"
            style={{
              borderColor:
                row.state === 'repaired' ? 'var(--state-repair)' : 'var(--rule-bright)',
            }}
          >
            {row.notes.map((note, i) => (
              <li
                key={`${i}-${note}`}
                className="row-in text-[12px]"
                style={{
                  color: row.state === 'repaired' ? 'var(--state-repair)' : 'var(--ink-dim)',
                }}
              >
                {note}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  )
}

function Result({ summary }: { summary: Complete }) {
  const paths = Object.entries(summary.attribution)
  return (
    <section className="row-in mt-10 border border-rule bg-ground-raised p-5" style={{ animationDelay: '80ms' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-rule pb-3">
        <h2 className="text-[11px] uppercase tracking-[0.26em] text-ink-dim">Specimen struck</h2>
        <div className="flex gap-6">
          <OpCounter value={summary.totalOps} label="operations" size="sm" />
          <div className="flex flex-col items-end">
            <span className="text-[18px] leading-none font-medium text-ink" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {secs(summary.totalMs)}
            </span>
            <span className="mt-1 text-[10px] uppercase tracking-[0.18em] text-ink-faint">total</span>
          </div>
        </div>
      </div>

      {summary.failed.length > 0 || summary.skipped.length > 0 ? (
        <p className="mt-3 text-[12px] text-ink-dim">
          {summary.failed.length} failed, {summary.skipped.length} skipped. The specimen was struck
          from what the rest measured.
        </p>
      ) : null}

      <dl className="mt-4 grid gap-x-8 gap-y-1 sm:grid-cols-2">
        {paths.map(([path, entry]) => (
          <div key={path} className="flex items-baseline justify-between gap-4 border-b border-rule py-1">
            <dt className="text-[12px] text-ink-faint">{path}</dt>
            <dd className="text-[12px] text-ink-dim">
              {entry.dominant}
              {entry.mode === 'blended' ? ` and ${entry.contributors.length - 1} more` : ''}
            </dd>
          </div>
        ))}
      </dl>

      {/* Task 16 hangs components/Specimen.tsx here, over the same params. */}
      <p className="mt-4 text-[11px] text-ink-faint">
        seed {summary.params.seed}, {summary.params.field.type} field, {summary.params.primitives.count}{' '}
        primitives, {summary.params.dither.matrix}x{summary.params.dither.matrix} dither
      </p>
    </section>
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

function groupByLayer(rows: Row[]): { layer: number; rows: Row[] }[] {
  const byLayer = new Map<number, Row[]>()
  for (const row of rows) {
    const list = byLayer.get(row.layer)
    if (list) list.push(row)
    else byLayer.set(row.layer, [row])
  }
  return [...byLayer.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([layer, group]) => ({ layer, rows: group }))
}

function reading(value: number | string): string {
  if (typeof value !== 'number') return value
  if (Number.isInteger(value)) return value.toLocaleString('en-US')
  return value.toFixed(3)
}

/** A deterministic operator lands in under a millisecond, and "0.00s" tells nobody anything. */
function took(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`
}

function secs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

export default FloorLine
