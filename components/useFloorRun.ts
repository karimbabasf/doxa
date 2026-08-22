'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlanRow, StreamEvent } from '@/app/api/run/route'

/**
 * The run, as state.
 *
 * Two screens read the same batch: the plain board a room watches, and the full line at
 * `?detail=1`. Both need identical answers about what is running right now, so the stream
 * is read once here rather than twice in two components that would drift.
 *
 * Events are applied one at a time as they arrive. Nothing is buffered and nothing is
 * replayed, so what a screen draws is what the factory is doing.
 */

export type RowState = 'idle' | 'live' | 'ok' | 'repaired' | 'failed' | 'skipped'

export type Row = PlanRow & {
  state: RowState
  startedAt?: number
  ms?: number
  ops?: number
  readings?: Record<string, number | string>
  error?: string
  because?: string
  notes: string[]
}

export type Complete = Extract<StreamEvent, { kind: 'complete' }>

export function patch(rows: Row[], id: string, fn: (row: Row) => Row): Row[] {
  return rows.map(row => (row.id === id ? fn(row) : row))
}

export function useFloorRun(batchId: string) {
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

  const alive = useRef(true)
  const started = useRef(false)

  const apply = useCallback((event: StreamEvent) => {
    if (!alive.current) return
    switch (event.kind) {
      case 'plan':
        setOpinion(event.opinion)
        setConcurrency(event.concurrency)
        setRows(event.ops.map(op => ({ ...op, state: 'idle', notes: [] })))
        break
      case 'start':
        setOpenedAt(at => at ?? event.at)
        setNow(Date.now())
        setRows(rs => patch(rs, event.id, r => ({ ...r, state: 'live', startedAt: event.at })))
        break
      case 'done': {
        // A repair is not a plain success. The field wing reports it, and it gets its own colour.
        const repaired = String(event.readings?.repaired ?? '') === 'yes'
        setRows(rs =>
          patch(rs, event.id, r => ({
            ...r,
            state: repaired ? 'repaired' : 'ok',
            ms: event.ms,
            ops: event.ops,
            readings: event.readings,
          })),
        )
        setTotalOps(n => n + event.ops)
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
        setRows(rs =>
          patch(rs, event.id, r => ({ ...r, state: 'failed', ms: event.ms, error: event.error })),
        )
        break
      case 'skip':
        setRows(rs => patch(rs, event.id, r => ({ ...r, state: 'skipped', because: event.because })))
        break
      case 'note':
        setRows(rs => patch(rs, event.id, r => ({ ...r, notes: [...r.notes, event.text] })))
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
      void readStream(batchId, apply, message => {
        if (alive.current) setFatal(message)
      })
    }
    return () => {
      alive.current = false
    }
  }, [batchId, apply])

  const liveCount = rows.filter(r => r.state === 'live').length
  const settled = rows.filter(r => r.state !== 'idle' && r.state !== 'live').length

  useEffect(() => {
    if (liveCount === 0) return
    const id = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(id)
  }, [liveCount])

  const elapsed = summary?.totalMs ?? stoppedMs ?? (openedAt ? Math.max(0, now - openedAt) : 0)

  return { rows, opinion, concurrency, totalOps, summary, alarm, fatal, now, liveCount, settled, elapsed }
}

/** Reads the SSE frames off the run and hands each one to the floor as it lands. */
export async function readStream(
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
      const line = frame.split('\n').find(l => l.startsWith('data: '))
      if (!line) continue
      try {
        apply(JSON.parse(line.slice(6)) as StreamEvent)
      } catch {
        // One unreadable frame must not stop the floor.
      }
    }
  }
}
