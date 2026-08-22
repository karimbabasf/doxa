'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CHIPS_SHOWN,
  STEPS,
  plainDuration,
  plainName,
  readingOrder,
  type StepId,
} from '@/lib/planLanguage'
import type { GateOperator } from './OperatorCard'

/**
 * The plan, on one screen, for a person who has never seen this before.
 *
 * The detailed graph still exists at `?detail=1`, and every switch on it still works.
 * This is the view the room reads: four steps left to right, the tools inside each one
 * as titles only, and one reason strip that never moves.
 *
 * Two rules the layout enforces rather than asks for:
 *   nothing scrolls, because a demo that scrolls loses the step it was on, and
 *   clicking a tool never changes the size of anything, because a screen that reflows
 *   under a pointer reads as broken however correct it is.
 */

type Props = {
  batchId: string
  opinion: string
  operators: GateOperator[]
  estMs: number
  signedAt?: string | null
}

const IDLE = 'Pick any tool above and its reason shows here.'

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export default function PlanBoard({ batchId, opinion, operators, estMs, signedAt }: Props) {
  const [why, setWhy] = useState<{ id: string; text: string } | null>(null)
  const [opened, setOpened] = useState<ReadonlySet<StepId>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const locked = Boolean(signedAt)

  // Every operator lands in exactly one step, by wing. A wing the steps do not claim
  // would vanish silently, so it is collected and shown rather than dropped.
  const byStep = useMemo(() => {
    const map = new Map<StepId, GateOperator[]>(STEPS.map(s => [s.id, []]))
    for (const op of operators) {
      const step = STEPS.find(s => s.wings.includes(op.wing))
      if (step) map.get(step.id)!.push(op)
    }
    for (const list of map.values()) list.sort((a, b) => readingOrder(a.id, b.id))
    return map
  }, [operators])

  const running = operators.filter(op => op.enabled)
  const onWeb = running.filter(op => op.wing === 'field').length

  const sign = useCallback(async () => {
    if (locked || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/plan/sign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ batchId, enabledIds: running.map(op => op.id) }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `The gate refused the signature with status ${res.status}.`)
      }
      window.location.assign(`/floor/${batchId}`)
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }, [batchId, busy, locked, running])

  // The keyboard route the old gate had. Signing is the one action on this screen and
  // it should not need a pointer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        void sign()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sign])

  const pick = useCallback((id: string, text: string) => {
    setWhy(current => (current?.id === id ? null : { id, text }))
  }, [])

  return (
    <main className="gate">
      <div className="gate-bar">
        <span className="gate-mark">DOXA</span>
        <span className="gate-what">THE PLAN</span>
        <span className="gate-batch">
          BATCH <b>{batchId}</b>
        </span>
      </div>

      <div className="gate-body">
        <div className="gate-said">
          <div className="gate-cap">YOU SAID</div>
          <blockquote>{opinion}</blockquote>
        </div>

        <div className="gate-cap">CLICK ANY TOOL TO SEE WHY IT WAS PICKED</div>

        <div className="gate-line">
          {STEPS.map(step => {
            const ops = byStep.get(step.id) ?? []
            const isWeb = step.id === 'web'
            const open = opened.has(step.id)
            const shown = open ? ops : ops.slice(0, CHIPS_SHOWN)
            const rest = ops.length - shown.length

            return (
              <section key={step.id} className={`gate-step${isWeb ? ' is-web' : ''}`}>
                <span className="gate-step-n">{step.n}</span>
                <h2>{step.title}</h2>
                <p>{step.line}</p>
                {isWeb && (
                  <span className="gate-badge">
                    <span className="gate-dot" />
                    BRIGHT DATA
                  </span>
                )}

                <div className="gate-tools">
                  {shown.map(op => (
                    <button
                      key={op.id}
                      type="button"
                      className={`gate-tool${op.enabled ? '' : ' is-off'}`}
                      aria-pressed={why?.id === op.id}
                      onClick={() => pick(op.id, op.rationale || op.blurb)}
                    >
                      {plainName(op.id, op.name)}
                    </button>
                  ))}

                  {step.id === 'print' && (
                    <>
                      <button
                        type="button"
                        className="gate-tool"
                        aria-pressed={why?.id === '#image'}
                        onClick={() =>
                          pick(
                            '#image',
                            'The finished image. One of a kind, because every number behind it came from your exact wording.',
                          )
                        }
                      >
                        The image
                      </button>
                      <button
                        type="button"
                        className="gate-tool"
                        aria-pressed={why?.id === '#receipt'}
                        onClick={() =>
                          pick(
                            '#receipt',
                            'Every reading, its number, and which tool produced it. This is what makes the image checkable rather than pretty.',
                          )
                        }
                      >
                        The receipt
                      </button>
                    </>
                  )}

                  {rest > 0 && (
                    <button
                      type="button"
                      className="gate-more"
                      onClick={() => setOpened(s => new Set(s).add(step.id))}
                    >
                      {rest} more
                    </button>
                  )}

                  {ops.length === 0 && step.id !== 'print' && (
                    <span className="gate-none">
                      {isWeb
                        ? 'The planner read your sentence and found nothing worth checking outside.'
                        : 'Nothing in this step for this sentence.'}
                    </span>
                  )}
                </div>
              </section>
            )
          })}
        </div>

        <div className={`gate-why${why ? '' : ' is-idle'}`}>
          <span className="gate-why-k">WHY</span>
          <span className="gate-why-v">{why?.text ?? IDLE}</span>
        </div>
      </div>

      <div className="gate-foot">
        {locked ? (
          <a className="gate-sign" href={`/floor/${batchId}`}>
            SIGNED, GO TO THE FLOOR
          </a>
        ) : (
          <button type="button" className="gate-sign" onClick={() => void sign()} disabled={busy}>
            {busy ? 'SENDING IT DOWN THE LINE' : 'SIGN IT AND RUN'}
          </button>
        )}
        <a className="gate-drop" href={`/gate/${batchId}?detail=1`}>
          SEE EVERY TOOL
        </a>
        {error ? (
          <span className="gate-error">{error}</span>
        ) : (
          <span className="gate-cost">
            <b>{running.length}</b> tools will run, <b>{onWeb}</b> of them on the live web. It
            takes {plainDuration(estMs)}
            {onWeb > 0 ? ', most of it waiting on the web' : ''}.
          </span>
        )}
      </div>
    </main>
  )
}
