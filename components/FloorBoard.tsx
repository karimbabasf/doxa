'use client'

import { useMemo } from 'react'
import { STEPS, plainName, readingOrder, type StepId } from '@/lib/planLanguage'
import { OpCounter } from './OpCounter'
import { useFloorRun, type Row, type RowState } from './useFloorRun'

/**
 * The run, on one screen, in the same four steps the person signed for.
 *
 * The gate promised four things would happen. This screen is those four things happening,
 * in the same order and under the same names, so nobody has to re-learn the shape of the
 * job at the exact moment it starts moving. The full line, one row per operator with every
 * reading it produced, is still at `?detail=1`.
 *
 * Nothing scrolls. A run that pushes its own beginning off the top of the screen loses the
 * story it is telling: the whole point is that a room can watch several tools work at once
 * and see the one that went out to the web take longer than the rest.
 */

type Props = { batchId: string }

const DOT: Record<RowState, string> = {
  idle: 'var(--rule-bright)',
  live: 'var(--state-live)',
  ok: 'var(--state-ok)',
  repaired: 'var(--state-repair)',
  failed: 'var(--state-fail)',
  skipped: 'var(--ink-faint)',
}

/** What a step is doing, from what its tools are doing. */
function stepState(rows: Row[]): RowState {
  if (rows.length === 0) return 'skipped'
  if (rows.some(r => r.state === 'live')) return 'live'
  if (rows.some(r => r.state === 'failed')) return 'failed'
  if (rows.some(r => r.state === 'repaired')) return 'repaired'
  if (rows.every(r => r.state === 'idle')) return 'idle'
  if (rows.every(r => r.state !== 'idle' && r.state !== 'live')) return 'ok'
  return 'live'
}

const STEP_WORD: Record<RowState, string> = {
  idle: 'WAITING',
  live: 'WORKING',
  ok: 'DONE',
  repaired: 'FIXED ITSELF',
  failed: 'A TOOL FAILED',
  skipped: 'NOTHING TO DO',
}

function secs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

export default function FloorBoard({ batchId }: Props) {
  const { rows, opinion, totalOps, summary, alarm, fatal, now, liveCount, settled, elapsed } =
    useFloorRun(batchId)

  const byStep = useMemo(() => {
    const map = new Map<StepId, Row[]>(STEPS.map(s => [s.id, []]))
    for (const row of rows) {
      const step = STEPS.find(s => s.wings.includes(row.wing))
      if (step) map.get(step.id)!.push(row)
    }
    for (const list of map.values()) list.sort((a, b) => readingOrder(a.id, b.id))
    return map
  }, [rows])

  // The repair is the story this build is built on, so any note a field tool writes is put
  // on the screen as it lands rather than left in the detailed view nobody opens.
  const webNotes = (byStep.get('web') ?? []).flatMap(r => r.notes)

  const done = Boolean(summary)

  return (
    <main className="gate floor">
      <div className="gate-bar">
        <span className="gate-mark">DOXA</span>
        <span className="gate-what">{done ? 'DONE' : 'RUNNING NOW'}</span>
        <span className="gate-batch">
          BATCH <b>{batchId}</b>
        </span>
      </div>

      <div className="gate-body">
        <div className="gate-said">
          <div className="gate-cap">YOU SAID</div>
          <blockquote>{opinion || 'Opening the line.'}</blockquote>
        </div>

        {fatal && <p className="gate-missing">The run did not start. {fatal}</p>}
        {alarm && <p className="gate-missing">No image was made. {alarm}</p>}

        <div className="gate-cap">
          {done
            ? 'EVERY STEP FINISHED. THE RECEIPT LISTS ALL OF IT.'
            : 'THE STEPS YOU SIGNED FOR, HAPPENING NOW'}
        </div>

        <div className="gate-line">
          {STEPS.map(step => {
            const ops = byStep.get(step.id) ?? []
            const isWeb = step.id === 'web'
            const isPrint = step.id === 'print'

            // The print step has no operators of its own. It is waiting until the merge
            // lands, and then it is the only thing on the screen that matters.
            const state: RowState = isPrint ? (done ? 'ok' : 'idle') : stepState(ops)
            const finished = ops.filter(r => r.state !== 'idle' && r.state !== 'live').length

            return (
              <section
                key={step.id}
                className={`gate-step floor-step${isWeb ? ' is-web' : ''}`}
                data-state={state}
              >
                <span className="gate-step-n">{step.n}</span>
                <h2>{step.title}</h2>

                <span className="floor-state" style={{ color: DOT[state] }}>
                  <i
                    className={state === 'live' ? 'floor-dot is-live' : 'floor-dot'}
                    style={{ background: DOT[state] }}
                  />
                  {STEP_WORD[state]}
                  {!isPrint && ops.length > 0 && (
                    <span className="floor-of">
                      {finished} of {ops.length}
                    </span>
                  )}
                </span>

                <div className="gate-tools floor-tools">
                  {ops.map(op => {
                    const running =
                      op.state === 'live' && op.startedAt ? Math.max(0, now - op.startedAt) : null
                    return (
                      <span
                        key={op.id}
                        className="gate-tool floor-tool"
                        data-state={op.state}
                        title={op.name}
                      >
                        <i className="floor-dot" style={{ background: DOT[op.state] }} />
                        {plainName(op.id, op.name)}
                        {running !== null && (
                          <b className="floor-t">{(running / 1000).toFixed(1)}s</b>
                        )}
                      </span>
                    )
                  })}

                  {isPrint && (
                    <>
                      <span className="gate-tool floor-tool" data-state={done ? 'ok' : 'idle'}>
                        <i className="floor-dot" style={{ background: DOT[done ? 'ok' : 'idle'] }} />
                        The image
                      </span>
                      <span className="gate-tool floor-tool" data-state={done ? 'ok' : 'idle'}>
                        <i className="floor-dot" style={{ background: DOT[done ? 'ok' : 'idle'] }} />
                        The receipt
                      </span>
                    </>
                  )}

                  {ops.length === 0 && !isPrint && (
                    <span className="gate-none">
                      {isWeb
                        ? 'Nothing in your sentence needed checking outside.'
                        : 'Nothing in this step for this sentence.'}
                    </span>
                  )}
                </div>
              </section>
            )
          })}
        </div>

        {/* One line, fixed height. What the web step is saying right now, or the summary. */}
        <div className={`gate-why${webNotes.length === 0 && !summary ? ' is-idle' : ''}`}>
          <span className="gate-why-k">{webNotes.length > 0 ? 'FROM THE WEB' : 'NOW'}</span>
          <span className="gate-why-v">
            {webNotes.length > 0
              ? webNotes[webNotes.length - 1]
              : summary
                ? `${settled} tools finished. ${summary.failed.length} failed, ${summary.skipped.length} skipped. The image was made from what the rest measured.`
                : liveCount > 0
                  ? `${liveCount} ${liveCount === 1 ? 'tool is' : 'tools are'} working at the same time.`
                  : 'Waiting for the first tool to start.'}
          </span>
        </div>
      </div>

      <div className="gate-foot">
        {done ? (
          <a className="gate-sign" href={`/certificate/${batchId}`}>
            SEE THE IMAGE AND THE RECEIPT
          </a>
        ) : (
          <span className="gate-sign is-waiting">
            <i className="floor-dot is-live" style={{ background: 'var(--ground)' }} />
            WORKING
          </span>
        )}
        <a className="gate-drop" href={`/floor/${batchId}?detail=1`}>
          SEE EVERY TOOL
        </a>

        <div className="floor-numbers">
          <OpCounter value={totalOps} label="measurements taken" />
          <div className="floor-clock">
            <span className="floor-clock-v">{secs(elapsed)}</span>
            <span className="floor-clock-k">SO FAR</span>
          </div>
        </div>
      </div>
    </main>
  )
}
