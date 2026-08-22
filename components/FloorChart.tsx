'use client'

import { useMemo } from 'react'
import type { Wing } from '@/lib/types'

/**
 * The run, drawn as a timeline instead of recited as a log.
 *
 * The floor's own comment says the point of the screen is that the run is concurrent
 * and has to look concurrent. A stack of rows carrying a millisecond figure each does
 * not show that: the reader has to hold seventeen numbers in their head and do the
 * overlapping themselves. A bar chart against a shared clock does it for them, and the
 * layers stop being a heading and start being a shape.
 *
 * It doubles as the wait. A run with a field operator in it takes about ninety seconds,
 * almost all of it one scrape, and that fact is legible here the moment the bar for
 * that operator dwarfs everything else. Nothing has to be said about it in words.
 *
 * The scale is honest about being live: the axis grows with the run and snaps to round
 * numbers rather than sliding, so the bars rescale in steps a person can follow instead
 * of creeping continuously. Sub-millisecond operators keep a two pixel minimum, because
 * a bar that rounds to nothing reads as an operator that did not run.
 */

export type ChartState = 'idle' | 'live' | 'ok' | 'repaired' | 'failed' | 'skipped'

export type ChartRow = {
  id: string
  name: string
  wing: Wing
  layer: number
  estMs: number
  state: ChartState
  startedAt?: number
  ms?: number
  ops?: number
}

type Props = {
  rows: ChartRow[]
  /** When the first operator started. Everything on the axis is measured from here. */
  openedAt: number | null
  now: number
}

const WING_INK: Record<Wing, string> = {
  field: 'var(--wing-field)',
  forensics: 'var(--wing-forensics)',
  semantics: 'var(--wing-semantics)',
  esoteric: 'var(--wing-esoteric)',
}

/** Four intervals is as many gridlines as this width carries without clutter. */
const TICKS = 4

/** A bar this thin is still a bar. Below it, a fast operator looks like it never ran. */
const MIN_BAR_PCT = 0.4

/**
 * The axis rounds up to one of these times a power of ten, so a growing run steps
 * between round scales instead of sliding under the reader.
 */
function niceSpan(ms: number): number {
  const target = Math.max(ms * 1.08, 1000)
  const pow = 10 ** Math.floor(Math.log10(target))
  for (const step of [1, 2, 2.5, 5]) {
    if (step * pow >= target) return step * pow
  }
  return 10 * pow
}

function tickLabel(ms: number, span: number): string {
  if (ms === 0) return '0'
  if (span <= 4000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 1000)}s`
}

function took(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`
}

export function FloorChart({ rows, openedAt, now }: Props) {
  const ordered = useMemo(
    () => [...rows].sort((a, b) => a.layer - b.layer || a.id.localeCompare(b.id)),
    [rows],
  )

  const span = useMemo(() => {
    if (openedAt === null) return 1000
    // The axis has to cover the longest bar, not just the clock, or a operator that
    // is still running walks off the right edge of its own chart.
    let widest = now - openedAt
    for (const row of rows) {
      if (row.startedAt === undefined) continue
      const end = row.ms !== undefined ? row.startedAt + row.ms : now
      widest = Math.max(widest, end - openedAt)
    }
    return niceSpan(widest)
  }, [rows, openedAt, now])

  if (ordered.length === 0 || openedAt === null) return null

  const ticks = Array.from({ length: TICKS + 1 }, (_, i) => (span / TICKS) * i)

  return (
    <section className="gantt" aria-label="The run over time">
      <div className="gantt-head">
        <span className="gantt-cap">EVERY TOOL AGAINST ONE CLOCK</span>
        <span className="gantt-span">0 to {tickLabel(span, span)}</span>
      </div>

      <div className="gantt-body">
        <div className="gantt-grid" aria-hidden="true">
          {ticks.map(tick => (
            <span key={tick} className="gantt-line" style={{ left: `${(tick / span) * 100}%` }} />
          ))}
        </div>

        {ordered.map((row, i) => {
          const previous = i === 0 ? null : ordered[i - 1]
          const opensLayer = previous === null || previous.layer !== row.layer

          const start = row.startedAt === undefined ? null : row.startedAt - openedAt
          const end =
            row.startedAt === undefined
              ? null
              : row.ms !== undefined
                ? row.startedAt + row.ms - openedAt
                : now - openedAt

          const left = start === null ? 0 : (start / span) * 100
          const width =
            start === null || end === null ? 0 : Math.max(MIN_BAR_PCT, ((end - start) / span) * 100)

          const value =
            row.state === 'skipped'
              ? 'not run'
              : row.ms !== undefined
                ? `${took(row.ms)}${row.ops !== undefined ? `, ${row.ops.toLocaleString('en-US')} ops` : ''}`
                : row.state === 'live'
                  ? `t+${((now - (row.startedAt ?? now)) / 1000).toFixed(1)}s`
                  : 'waiting'

          return (
            <div key={row.id}>
              {opensLayer ? (
                <div className="gantt-layer">
                  <span>LAYER {row.layer + 1}</span>
                </div>
              ) : null}

              <div
                className="gantt-row"
                data-state={row.state}
                title={`${row.id}, ${row.name}, ${row.wing} wing, ${value}`}
              >
                <span className="gantt-id">
                  <i className="gantt-swatch" style={{ background: WING_INK[row.wing] }} />
                  {row.id}
                </span>

                <div className="gantt-track">
                  {start === null ? null : (
                    <span
                      className={row.state === 'live' ? 'gantt-bar is-live' : 'gantt-bar'}
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        background:
                          row.state === 'failed' ? 'var(--state-fail)' : WING_INK[row.wing],
                      }}
                    />
                  )}
                </div>

                <span className="gantt-val">{value}</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="gantt-ticks" aria-hidden="true">
        {ticks.map((tick, i) => (
          <span
            key={tick}
            style={{
              left: `${(tick / span) * 100}%`,
              // The end labels hang off their own axis if they are centred on it.
              transform:
                i === 0 ? 'none' : i === ticks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
            }}
          >
            {tickLabel(tick, span)}
          </span>
        ))}
      </div>
    </section>
  )
}

export default FloorChart
