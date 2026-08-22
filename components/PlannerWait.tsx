'use client'

import { useEffect, useState } from 'react'
import { ProgressBar } from './interior/progress-bar'
import { TaskSteps } from './interior/task-steps'

/**
 * The wait between pressing compose and the plan appearing.
 *
 * The planner takes about eight seconds against gpt-5.2, which is long enough that a
 * single line of text next to the button reads as a hang. It is also the moment the
 * whole premise of the app is being decided: an agent is writing a plan for this exact
 * sentence. Showing nothing there wastes the one wait a person is happy to sit through.
 *
 * The two moving parts are `TaskSteps` and `ProgressBar` out of the interior kit rather
 * than hand-rolled. Both already carry the parts that are tedious to get right and easy
 * to get wrong: a live region that announces the step without shouting every tick, a
 * reduced-motion path, and a bar that reports its own value to a screen reader.
 *
 * What stays local is the honesty. The clock is measured. The stages are the planner's
 * real steps but their timings are the shape of a typical run, not a report from inside
 * this one, and the screen says so rather than implying a progress feed that does not
 * exist. The bar decelerates and never arrives, because a bar that fills to the brim and
 * then sits there is a lie told twice.
 */

/** The planner's own steps, with the point in a typical run where each one starts. */
const STAGES = [
  { id: 'read', at: 0, label: 'Reading the sentence', meta: 'What kind of claim is this' },
  {
    id: 'measure',
    at: 1600,
    label: 'Measuring what it can',
    meta: 'Which instruments have anything to say',
  },
  {
    id: 'choose',
    at: 3400,
    label: 'Choosing the instruments',
    meta: 'Picking the ones this text earns',
  },
  {
    id: 'order',
    at: 5800,
    label: 'Ordering the line',
    meta: 'What can run at once, what has to wait',
  },
]

/** The time constant of the approach. Roughly the planner's measured eight seconds. */
const TAU_MS = 5200

/** The bar stops here. The remainder belongs to the answer, which has not arrived. */
const CEILING = 0.94

export function PlannerWait({ opinion }: { opinion: string }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const start = Date.now()
    const id = setInterval(() => setElapsed(Date.now() - start), 100)
    return () => clearInterval(id)
  }, [])

  const progress = Math.min(CEILING, 1 - Math.exp(-elapsed / TAU_MS))

  // The last stage never completes on its own. The plan landing is what completes it,
  // and this component is unmounted at that moment rather than being told about it.
  let current = 0
  for (let i = 0; i < STAGES.length; i += 1) {
    if (elapsed >= STAGES[i].at) current = i
  }

  return (
    <section className="wait">
      <div className="wait-bar">
        <span className="wait-what">COMPOSING THE WORK ORDER</span>
        <span className="wait-clock">t+{(elapsed / 1000).toFixed(1)}s</span>
      </div>

      <div className="wait-said">
        <p>{opinion}</p>
        <span className="wait-sweep" aria-hidden="true" />
      </div>

      <div className="wait-steps">
        <TaskSteps steps={STAGES} current={current} label="Composing the work order" />
      </div>

      <div className="wait-progress">
        <ProgressBar
          value={Math.round(progress * 100)}
          label="Planner"
          pendingLabel="Composing"
          completeLabel="Composed"
        />
      </div>

      <p className="wait-foot">
        The clock is measured. The marks against each step are the shape of a typical run,
        not a report from inside this one. The planner usually answers in about eight seconds,
        and it is writing a plan for your exact sentence, so the wait is the work.
      </p>
    </section>
  )
}

export default PlannerWait
