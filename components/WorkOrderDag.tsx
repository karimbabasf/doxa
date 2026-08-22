'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { layer } from '@/lib/executor/topo'
import type { Operator } from '@/lib/types'
import OperatorCard, { listOf, type CardState, type GateOperator } from './OperatorCard'

export type { GateOperator } from './OperatorCard'

/**
 * The work order, drawn as the factory will run it.
 *
 * The graph is not stored anywhere. It is read out of each operator's `needs`, which
 * is the same field the executor sorts on, so the picture a person signs and the order
 * the machine runs cannot drift apart.
 *
 * The rule this screen exists to enforce: switching an instrument off switches off
 * everything that reads its result. That is stated while the pointer is still on the
 * switch, marked on the graph, and repeated in words after the click. A person should
 * never learn what a switch did by watching the floor fail.
 */

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

type Resolved = { on: boolean; blockedBy: string[] }
type Line = { from: string; to: string; d: string; x: number; y: number }
type Geometry = { w: number; h: number; lines: Line[] }

const EMPTY_GEOMETRY: Geometry = { w: 0, h: 0, lines: [] }

/**
 * An operator runs when nobody switched it off and every need of its own is running.
 * Deriving it this way, rather than storing an enabled flag per card, is what lets a
 * dependency come back and bring its dependents with it while leaving the ones a
 * person refused by hand switched off.
 */
function resolve(layers: GateOperator[][], off: ReadonlySet<string>): Map<string, Resolved> {
  const state = new Map<string, Resolved>()
  for (const layer of layers) {
    for (const op of layer) {
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

type Anchor = { from: string; to: string; x1: number; y1: number; x2: number; y2: number }

/** The gap between columns, and the lane the vertical run of every wire sits in. */
const GUTTER = 64

/**
 * Wires run square, not diagonal: out of the right edge, down the gutter, into the
 * left edge, with rounded corners. A column can hold a dozen instruments, and a
 * diagonal across that height crosses every card between the two ends. A square run
 * stays in the gutter, and the cards are opaque, so anything that does cross passes
 * behind them like cabling behind a panel.
 */
function elbow(end: Anchor, mid: number): string {
  const { x1, y1, x2, y2 } = end
  if (Math.abs(y2 - y1) < 2) return `M ${x1} ${y1} L ${x2} ${y2}`
  const radius = Math.max(0, Math.min(10, Math.abs(y2 - y1) / 2, Math.abs(mid - x1), Math.abs(x2 - mid)))
  const down = y2 > y1 ? 1 : -1
  const along = mid > x1 ? 1 : -1
  return [
    `M ${x1} ${y1}`,
    `L ${mid - radius * along} ${y1}`,
    `Q ${mid} ${y1} ${mid} ${y1 + radius * down}`,
    `L ${mid} ${y2 - radius * down}`,
    `Q ${mid} ${y2} ${mid + radius} ${y2}`,
    `L ${x2} ${y2}`,
  ].join(' ')
}

function sameGeometry(a: Geometry, b: Geometry): boolean {
  if (a.w !== b.w || a.h !== b.h || a.lines.length !== b.lines.length) return false
  return a.lines.every((line, i) => line.d === b.lines[i].d && line.to === b.lines[i].to)
}

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0)
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Signing without a callback posts the order and hands the batch to the floor. */
async function postSignature(batchId: string, enabledIds: string[]): Promise<void> {
  const res = await fetch('/api/plan/sign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ batchId, enabledIds }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `The gate refused the signature with status ${res.status}.`)
  }
  window.location.assign(`/floor/${batchId}`)
}

type Props = {
  batchId: string
  operators: GateOperator[]
  signedAt?: string | null
  onSign?: (enabledIds: string[]) => void | Promise<void>
}

export default function WorkOrderDag({ batchId, operators, signedAt, onSign }: Props) {
  const [off, setOff] = useState<ReadonlySet<string>>(
    () => new Set(operators.filter(op => !op.enabled).map(op => op.id)),
  )
  const [preview, setPreview] = useState<string | null>(null)
  const [lastAction, setLastAction] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [geometry, setGeometry] = useState<Geometry>(EMPTY_GEOMETRY)

  const boardRef = useRef<HTMLDivElement | null>(null)
  const cards = useRef(new Map<string, HTMLLIElement>())

  const locked = Boolean(signedAt)

  const layered = useMemo(() => {
    try {
      // layer reads id and needs only, so metadata without a run function is enough.
      return { layers: layer(operators as unknown as Operator[]) as unknown as GateOperator[][], fault: null }
    } catch (err) {
      return { layers: [operators], fault: message(err) }
    }
  }, [operators])

  const layers = layered.layers
  const flat = useMemo(() => layers.flat(), [layers])
  const state = useMemo(() => resolve(layers, off), [layers, off])
  const enabledIds = useMemo(
    () => flat.filter(op => state.get(op.id)?.on).map(op => op.id),
    [flat, state],
  )

  const edges = useMemo(() => {
    const present = new Set(operators.map(op => op.id))
    const out: { from: string; to: string }[] = []
    for (const op of operators) {
      for (const need of new Set(op.needs)) {
        if (present.has(need)) out.push({ from: need, to: op.id })
      }
    }
    return out
  }, [operators])

  /** What flipping one switch would change, worked out before anybody flips it. */
  const consequenceOf = useCallback(
    (id: string): string[] => {
      const next = new Set(off)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      const after = resolve(layers, next)
      return flat
        .filter(op => op.id !== id && Boolean(state.get(op.id)?.on) !== Boolean(after.get(op.id)?.on))
        .map(op => op.id)
    },
    [flat, layers, off, state],
  )

  const previewLost = useMemo(() => {
    if (!preview) return new Set<string>()
    return new Set([preview, ...consequenceOf(preview)])
  }, [preview, consequenceOf])

  const consequence = useMemo(() => {
    if (!preview) return null
    const changed = consequenceOf(preview)
    const turningOff = !off.has(preview)
    if (changed.length === 0) {
      return turningOff
        ? `${preview} carries nothing with it. Nothing else on this order reads its result.`
        : `${preview} comes back on its own. Nothing else was waiting on it.`
    }
    return turningOff
      ? `Switching ${preview} off also stops ${listOf(changed)}, because ${changed.length > 1 ? 'they read' : 'it reads'} its result.`
      : `Switching ${preview} back on also restores ${listOf(changed)}.`
  }, [preview, consequenceOf, off])

  const totals = useMemo(() => {
    const running = layers
      .map(layer => layer.filter(op => state.get(op.id)?.on))
      .filter(layer => layer.length > 0)
    const flatRunning = running.flat()
    return {
      count: flatRunning.length,
      cost: sum(flatRunning.map(op => op.costUnits)),
      // Everything in one layer runs at once, so a layer costs its slowest instrument.
      ms: sum(running.map(layer => Math.max(...layer.map(op => op.estMs)))),
      ops: sum(flatRunning.map(op => op.estOps)),
    }
  }, [layers, state])

  const toggle = useCallback(
    (id: string) => {
      if (locked) return
      const changed = consequenceOf(id)
      const turningOff = !off.has(id)
      setOff(current => {
        const next = new Set(current)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      setError(null)
      setLastAction(
        turningOff
          ? changed.length
            ? `${id} off. It took ${listOf(changed)} with it.`
            : `${id} off. Nothing else needed it.`
          : changed.length
            ? `${id} back on. ${listOf(changed)} came back with it.`
            : `${id} back on.`,
      )
    },
    [consequenceOf, locked, off],
  )

  const sign = useCallback(async () => {
    if (locked || busy || enabledIds.length === 0) return
    setBusy(true)
    setError(null)
    try {
      await (onSign ? onSign(enabledIds) : postSignature(batchId, enabledIds))
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }, [batchId, busy, enabledIds, locked, onSign])

  /* Signing is a keyboard action, so it gets a keyboard route and no animation. */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      void sign()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sign])

  const measure = useCallback(() => {
    const board = boardRef.current
    if (!board) return
    const base = board.getBoundingClientRect()
    if (!base.width || !base.height) {
      setGeometry(current => (current.lines.length ? EMPTY_GEOMETRY : current))
      return
    }

    const ends: Anchor[] = []
    for (const edge of edges) {
      const from = cards.current.get(edge.from)
      const to = cards.current.get(edge.to)
      if (!from || !to) continue
      const a = from.getBoundingClientRect()
      const b = to.getBoundingClientRect()
      ends.push({
        from: edge.from,
        to: edge.to,
        x1: a.right - base.left,
        y1: a.top - base.top + a.height / 2,
        x2: b.left - base.left,
        y2: b.top - base.top + b.height / 2,
      })
    }

    // Every wire into one column drops down the same gutter, so the lanes are shared
    // out across it. Otherwise four edges into one column sit on top of each other and
    // read as one wire.
    const byGutter = new Map<number, Anchor[]>()
    for (const end of ends) {
      const key = Math.round(end.x2)
      const group = byGutter.get(key)
      if (group) group.push(end)
      else byGutter.set(key, [end])
    }

    const lines: Line[] = []
    for (const group of byGutter.values()) {
      group.sort((one, two) => one.y1 - two.y1)
      const lane = group.length > 1 ? Math.min(9, 40 / (group.length - 1)) : 0
      group.forEach((end, index) => {
        const offset = (index - (group.length - 1) / 2) * lane
        lines.push({
          from: end.from,
          to: end.to,
          d: elbow(end, end.x2 - GUTTER / 2 + offset),
          x: end.x2,
          y: end.y2,
        })
      })
    }

    const next: Geometry = { w: base.width, h: base.height, lines }
    setGeometry(current => (sameGeometry(current, next) ? current : next))
  }, [edges])

  const offKey = [...off].sort().join(',')
  useIsomorphicLayoutEffect(() => {
    measure()
  }, [measure, layers, offKey])

  useEffect(() => {
    const board = boardRef.current
    if (!board || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(board)
    for (const card of cards.current.values()) observer.observe(card)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure, layers])

  const cardState = (id: string): CardState => {
    const resolved = state.get(id)
    if (resolved?.on) return 'on'
    return off.has(id) ? 'off' : 'blocked'
  }

  return (
    <div className="flex flex-col gap-6">
      {layered.fault && (
        <p className="border border-state-fail px-4 py-3 text-[12px] text-state-fail">
          This work order cannot be drawn as a graph: {layered.fault}
        </p>
      )}

      <div className="overflow-x-auto pb-2">
        <div ref={boardRef} className="relative inline-flex items-start px-1 py-1"
          style={{ gap: `${GUTTER}px` }}>
          <svg
            className="pointer-events-none absolute left-0 top-0"
            width={geometry.w}
            height={geometry.h}
            aria-hidden="true"
          >
            {geometry.lines.map(line => {
              const live = state.get(line.from)?.on && state.get(line.to)?.on
              const hot = previewLost.has(line.from) && previewLost.has(line.to)
              const stroke = hot ? 'var(--signal)' : live ? 'var(--rule-bright)' : 'var(--rule)'
              return (
                <g key={`${line.from}-${line.to}`}>
                  <path
                    d={line.d}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={hot ? 1.6 : 1}
                    strokeDasharray={live ? undefined : '3 4'}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  <circle cx={line.x} cy={line.y} r={hot ? 2.6 : 2} fill={stroke} />
                </g>
              )
            })}
          </svg>

          {layers.map((layer, index) => (
            <div key={index} data-layer={index} className="relative w-[272px] shrink-0">
              <div className="mb-3 border-b border-rule pb-2">
                <div className="text-[10px] tracking-[0.16em] text-ink-faint">
                  LAYER {String(index + 1).padStart(2, '0')}
                </div>
                <div className="text-[10px] text-ink-faint">
                  {layer.length === 1 ? '1 instrument' : `${layer.length} instruments run at once`}
                </div>
              </div>
              <ol className="flex flex-col gap-4">
                {layer.map(op => (
                  <OperatorCard
                    key={op.id}
                    op={op}
                    state={cardState(op.id)}
                    blockedBy={state.get(op.id)?.blockedBy ?? []}
                    inBlastRadius={previewLost.has(op.id)}
                    faded={preview !== null && !previewLost.has(op.id)}
                    locked={locked}
                    onToggle={() => toggle(op.id)}
                    onPreview={on => setPreview(current => (on ? op.id : current === op.id ? null : current))}
                    anchor={el => {
                      if (el) cards.current.set(op.id, el)
                      else cards.current.delete(op.id)
                    }}
                  />
                ))}
              </ol>
            </div>
          ))}
        </div>
      </div>

      {/*
        Both lines are always on screen and the strip holds its height, so reading the
        consequence of a switch never moves the board under the pointer.
      */}
      <div
        className="min-h-[3.4rem] border-l-2 border-signal bg-ground-raised px-4 py-2"
        aria-live="polite"
      >
        <p data-testid="consequence" className="text-[12px] text-ink">
          {consequence ?? 'Hold a switch to read what it takes with it.'}
        </p>
        <p data-testid="last-action" className="mt-1 text-[11px] text-ink-dim">
          {lastAction ?? `Batch ${batchId}. Nothing runs until you sign.`}
        </p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-6 border-t border-rule pt-5">
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-[11px]">
          <div>
            <dt className="text-[10px] tracking-[0.14em] text-ink-faint">INSTRUMENTS</dt>
            <dd data-testid="total-count" className="text-[17px] text-ink">
              {totals.count}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] tracking-[0.14em] text-ink-faint">COST UNITS</dt>
            <dd data-testid="total-cost" className="text-[17px] text-ink">
              {totals.cost}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] tracking-[0.14em] text-ink-faint">EST MS</dt>
            <dd data-testid="total-ms" className="text-[17px] text-ink">
              {totals.ms}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] tracking-[0.14em] text-ink-faint">EST OPS</dt>
            <dd data-testid="total-ops" className="text-[17px] text-ink">
              {totals.ops}
            </dd>
          </div>
        </dl>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          {error && <p className="max-w-md text-[11px] text-state-fail">{error}</p>}
          {locked ? (
            <>
              <p data-testid="signature" className="text-[11px] text-state-ok">
                SIGNED {(signedAt as string).replace('T', ' ').slice(0, 16)} UTC
              </p>
              <a
                href={`/floor/${batchId}`}
                className="border border-state-ok px-5 py-2 text-[11px] tracking-[0.14em] text-state-ok"
              >
                OPEN THE FLOOR
              </a>
            </>
          ) : (
            <>
              <p className="text-[10px] text-ink-faint">
                {enabledIds.length === 0
                  ? 'Every instrument is switched off. There is nothing to run.'
                  : 'Your signature is the plan of record. Cmd or Ctrl plus Enter also signs.'}
              </p>
              <button
                type="button"
                onClick={() => void sign()}
                disabled={enabledIds.length === 0 || busy}
                className={`border px-5 py-2 text-[11px] tracking-[0.14em] ${
                  enabledIds.length === 0 || busy
                    ? 'cursor-not-allowed border-rule text-ink-faint'
                    : 'cursor-pointer border-signal bg-signal text-ground'
                }`}
              >
                {busy ? 'SIGNING' : 'SIGN AND OPEN THE FLOOR'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
