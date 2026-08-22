'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  STEPS,
  plainDuration,
  plainName,
  readingOrder,
  type Step,
  type StepId,
} from '@/lib/planLanguage'
import { enabledIds, estimateMs, resolveList, type Resolved } from '@/lib/planSwitches'
import type { Wing } from '@/lib/types'
import { DitherButton } from './dither-kit'
import { listOf, type GateOperator } from './OperatorCard'

/**
 * The plan, on one screen, for a person who has never seen this before.
 *
 * The screen reads as one line of machinery: steps in boxes, a lit conduit carrying the
 * work out of each box into the next, and inside each box the tools the planner actually
 * picked for this sentence. The conduit is the claim the old chevron only hinted at, that
 * this is a pipeline and step 3 is fed by step 2.
 *
 * Every step also opens a menu of its own switches, so a tool can be refused here rather
 * than by travelling to the graph at `?detail=1`. The switch rule is shared with that
 * screen (`lib/planSwitches.ts`), so the two cannot disagree about what a flip did, and
 * the footer reads its estimate off the switches rather than off the stored order, so the
 * wait visibly falls when the web is switched off.
 *
 * Two rules the layout still enforces rather than asks for:
 *   the page never scrolls, so a demo cannot lose the step it was on, and
 *   clicking a tool never changes the size of anything. Opening a menu does, because that
 *   is the thing the person just asked for, and it grows inside its own step.
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

const WING_INK: Record<Wing, string> = {
  field: 'var(--wing-field)',
  forensics: 'var(--wing-forensics)',
  semantics: 'var(--wing-semantics)',
  esoteric: 'var(--wing-esoteric)',
}

type SwitchState = 'on' | 'off' | 'held'

/** A refusal and a block look the same on the floor. On the gate they must not. */
function switchState(resolved: Resolved | undefined): SwitchState {
  if (!resolved) return 'off'
  if (resolved.on) return 'on'
  return resolved.blockedBy.length > 0 ? 'held' : 'off'
}

export default function PlanBoard({ batchId, opinion, operators, estMs, signedAt }: Props) {
  const [why, setWhy] = useState<{ id: string; text: string } | null>(null)
  const [off, setOff] = useState<ReadonlySet<string>>(
    () => new Set(operators.filter(op => !op.enabled).map(op => op.id)),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const locked = Boolean(signedAt)
  const refused = useMemo(() => operators.filter(op => !op.enabled).length, [operators])

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

  const state = useMemo(() => resolveList(operators, off), [operators, off])
  const running = useMemo(() => operators.filter(op => state.get(op.id)?.on), [operators, state])
  const onWeb = running.filter(op => op.wing === 'field').length

  // The stored estimate is the number the planner signed off with. The moment a switch
  // moves it is stale, so the footer recomputes and falls back to the stored figure only
  // while nothing has been touched.
  const waitMs = off.size === refused ? estMs : estimateMs(operators, state)

  const sign = useCallback(async () => {
    if (locked || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/plan/sign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ batchId, enabledIds: enabledIds(operators, state) }),
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
  }, [batchId, busy, locked, operators, state])

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

  /**
   * A switch says what it did while the pointer is still on it. Learning that a flip took
   * three other tools with it by watching the floor fail is the exact failure this screen
   * exists to prevent, so the consequence is written into the reason strip.
   */
  const flip = useCallback(
    (op: GateOperator) => {
      if (locked) return
      const next = new Set(off)
      const turningOff = !next.has(op.id)
      if (turningOff) next.add(op.id)
      else next.delete(op.id)

      const after = resolveList(operators, next)
      const name = plainName(op.id, op.name)
      const moved = (wanted: boolean) =>
        operators
          .filter(
            other =>
              other.id !== op.id &&
              Boolean(state.get(other.id)?.on) === !wanted &&
              Boolean(after.get(other.id)?.on) === wanted,
          )
          .map(other => plainName(other.id, other.name))

      if (turningOff) {
        const lost = moved(false)
        setWhy({
          id: op.id,
          text:
            lost.length > 0
              ? `${name} is off, and that holds back ${listOf(lost)}, because ${lost.length > 1 ? 'they read' : 'it reads'} its result.`
              : `${name} is off. Nothing else on this plan reads its result, so nothing else changed.`,
        })
      } else {
        const back = moved(true)
        setWhy({
          id: op.id,
          text:
            back.length > 0
              ? `${name} is back on, and so ${listOf(back)} can run again.`
              : `${name} is back on.`,
        })
      }

      setOff(next)
    },
    [locked, off, operators, state],
  )

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

        <div className="gate-cap">
          CLICK A TOOL FOR ITS REASON. FLIP ITS SWITCH TO TAKE IT OFF THE LINE.
        </div>

        <div className="gate-line">
          {STEPS.map((step, index) => {
            const ops = byStep.get(step.id) ?? []
            const isWeb = step.id === 'web'
            const live = ops.filter(op => state.get(op.id)?.on)

            // The web step is the one the room is here to see, but only when it has
            // something to do. An empty step wearing the accent colour and the live
            // badge points the whole screen at the one box that is not going to run,
            // which is how the gate came to advertise its own no-op.
            const leaves = isWeb && live.length > 0
            const stayed = isWeb && live.length === 0

            const upstream = index > 0 ? (byStep.get(STEPS[index - 1].id) ?? []) : []

            return (
              <Fragment key={step.id}>
                {index > 0 && (
                  <Conduit
                    seam={index}
                    from={STEPS[index - 1]}
                    carrying={upstream.some(op => state.get(op.id)?.on)}
                  />
                )}

                <section
                  className={`gate-step${leaves ? ' is-web' : ''}${stayed ? ' is-stayed' : ''}`}
                >
                  <div className="gate-step-bar">
                    <span className="gate-step-n">{step.n}</span>
                    {ops.length > 0 && (
                      <span className="gate-step-count">
                        {live.length} ON
                        {live.length < ops.length ? ` OF ${ops.length}` : ''}
                      </span>
                    )}
                    {stayed && ops.length === 0 && <span className="gate-step-count">NOT USED</span>}
                  </div>
                  <h2>{step.title}</h2>
                  <p>{step.line}</p>
                  {leaves && (
                    <span className="gate-badge">
                      <span className="gate-dot" />
                      BRIGHT DATA
                    </span>
                  )}

                  {ops.length === 0 ? (
                    <p className="gate-none">
                      {isWeb
                        ? 'The planner read your sentence and found nothing worth checking outside.'
                        : 'Nothing in this step for this sentence.'}
                    </p>
                  ) : (
                    <ul className="gate-rack">
                      {ops.map(op => {
                        const resolved = state.get(op.id)
                        const on = switchState(resolved)
                        const name = plainName(op.id, op.name)
                        return (
                          <li key={op.id} className="gate-rack-row" data-on={on}>
                            <button
                              type="button"
                              className="gate-rack-read"
                              aria-pressed={why?.id === op.id}
                              onClick={() =>
                                pick(
                                  op.id,
                                  on === 'held' && resolved
                                    ? `${name} is held back: it reads ${listOf(resolved.blockedBy)}, and ${resolved.blockedBy.length > 1 ? 'those are' : 'that is'} switched off.`
                                    : op.rationale || op.blurb,
                                )
                              }
                            >
                              <i
                                className="gate-rack-spine"
                                style={{ background: WING_INK[op.wing] }}
                              />
                              <span className="gate-rack-name" title={name}>
                                {name}
                              </span>
                              <span className="gate-rack-id">{op.id}</span>
                            </button>

                            <button
                              type="button"
                              role="switch"
                              aria-checked={on === 'on'}
                              aria-label={`${name}, ${on === 'on' ? 'on' : on === 'held' ? 'held back' : 'off'}`}
                              className="gate-rack-switch"
                              data-on={on}
                              disabled={locked || on === 'held'}
                              onClick={() => flip(op)}
                            >
                              <i className="gate-rack-box" />
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              </Fragment>
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
          // The kit documents `color` as a palette name or a hue, but its props
          // intersect ComponentProps<'button'>, whose own `color` attribute is a
          // string, so the number half of the union is unreachable. The signal is
          // an orange either way, and the solid fill underneath stays on purpose:
          // if the canvas never paints, the most important control on the screen
          // is still a legible button rather than a label on bare ground.
          <DitherButton
            color="orange"
            variant="solid"
            className="gate-sign"
            onClick={() => void sign()}
            disabled={busy || running.length === 0}
          >
            {busy ? 'SENDING IT DOWN THE LINE' : 'SIGN IT AND RUN'}
          </DitherButton>
        )}

        <a className="gate-drop" href={`/gate/${batchId}?detail=1`}>
          Or see the whole graph, with what feeds what
        </a>

        {error ? (
          <span className="gate-error">{error}</span>
        ) : running.length === 0 ? (
          <span className="gate-cost">
            Every tool is switched off, so there is nothing to run. Turn one back on.
          </span>
        ) : (
          <span className="gate-cost">
            <b>{running.length}</b> tools will run, <b>{onWeb}</b> of them on the live web. It
            takes {plainDuration(waitMs)}
            {onWeb > 0 ? ', most of it waiting on the web' : ''}.
          </span>
        )}
      </div>
    </main>
  )
}

/**
 * The seam between two steps, drawn as cabling rather than punctuation.
 *
 * A light runs left to right along the rail, and the seams are offset in time so the room
 * reads one pulse travelling the length of the line instead of two unrelated blinks. It
 * carries no data: nothing is running yet at the gate, and a conduit that pretended
 * otherwise would be this screen's first lie. It says direction, and it says these boxes
 * are joined. A seam whose upstream step has every tool switched off goes dark, because
 * nothing is going to come down it.
 */
function Conduit({ seam, from, carrying }: { seam: number; from: Step; carrying: boolean }) {
  return (
    <div
      className={`gate-conduit${from.id === 'web' ? ' is-web' : ''}`}
      data-carrying={carrying}
      aria-hidden="true"
      style={{ '--seam': seam } as React.CSSProperties}
    >
      <i className="gate-rail" />
      <i className="gate-spark" />
      <i className="gate-head" />
    </div>
  )
}
