'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import PlannerWait from '@/components/PlannerWait'
import type { WorkOrder } from '@/lib/types'

/**
 * The composing screen: the planner's eight seconds with the window to itself.
 *
 * Under the field this panel competed with the sentence still sitting in the textarea
 * and with the sample roll moving beneath it, and it read as something happening to the
 * form. It is not. It is the moment the plan for that exact sentence gets written, which
 * is the premise of the app, so it gets the screen.
 *
 * The request lives here rather than on the front door for the same reason: the screen
 * that shows the wait is the screen that owns it. A refusal therefore lands here too,
 * and it offers the sentence again rather than sending a person back to retype it.
 */

export function Composing({ opinion }: { opinion: string }) {
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const asked = useRef(-1)

  useEffect(() => {
    // Development mounts every effect twice. The planner is a paid call that writes a
    // batch row, so a second run would compose a second order and strand the first.
    //
    // The guard is a ref and there is no cleanup flag. A flag set false on the first
    // teardown would silence the one call that did go out, and the screen would sit on
    // the wait for ever with a finished request behind it. React keeps the instance
    // across that remount, so the setter below is still pointed at what is on screen.
    if (asked.current === attempt) return
    asked.current = attempt

    void (async () => {
      try {
        const res = await fetch('/api/plan', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ opinion }),
        })
        // A route that falls over answers in HTML, and a parse error thrown at a person
        // reads as a bug in their sentence. The status is the honest thing to report.
        const body = (await res.json().catch(() => ({}))) as Partial<WorkOrder> & {
          error?: string
        }
        if (!res.ok || !body.batchId) {
          throw new Error(body.error ?? `Intake refused the opinion with status ${res.status}.`)
        }
        // replace, not assign. The wait is over, and backing out of the gate should reach
        // the front door rather than compose the same sentence a second time.
        window.location.replace(`/gate/${body.batchId}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
  }, [opinion, attempt])

  const again = useCallback(() => {
    setError(null)
    setAttempt(n => n + 1)
  }, [])

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col px-6 py-10">
      <div className="flex items-baseline justify-between gap-4">
        <Link href="/" className="text-[15px] tracking-[0.34em] text-ink no-underline">
          DOXA
        </Link>
        <span
          className={`text-[10px] tracking-[0.14em] ${error ? 'text-state-fail' : 'text-ink-faint'}`}
        >
          {error ? 'THE LINE DID NOT START' : 'STAND BY'}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-center py-8">
        {error ? (
          <Refusal opinion={opinion} error={error} onRetry={again} />
        ) : (
          <PlannerWait opinion={opinion} />
        )}
      </div>
    </main>
  )
}

/**
 * The refusal. The sentence stays on screen and the button sends the same one back in,
 * because the planner fails at the network far more often than it fails at the wording.
 */
function Refusal({
  opinion,
  error,
  onRetry,
}: {
  opinion: string
  error: string
  onRetry: () => void
}) {
  return (
    <section className="border border-rule bg-ground-raised">
      <div className="border-b border-rule bg-ground-sunk px-4 py-3">
        <span className="text-[10px] tracking-[0.16em] text-state-fail">NOTHING WAS COMPOSED</span>
      </div>

      <div className="border-b border-rule px-4 py-4">
        <p className="prose-sans border-l-2 border-state-fail pl-3 text-[15px] leading-[1.45] text-ink">
          {opinion}
        </p>
      </div>

      <p className="prose-sans px-4 pt-4 text-[12px] leading-[1.5] text-state-fail">{error}</p>

      <p className="prose-sans px-4 pt-2 text-[11.5px] leading-[1.55] text-ink-faint">
        No batch was opened and nothing was spent. The sentence above is still the one on
        the order, so it can go in again as it is.
      </p>

      <div className="flex items-center gap-5 px-4 pb-4 pt-4">
        <button
          type="button"
          onClick={onRetry}
          className="intake-go"
        >
          COMPOSE IT AGAIN
        </button>
        <Link
          href="/"
          className="text-[10px] tracking-[0.16em] text-ink-faint no-underline hover:text-ink"
        >
          BACK TO INTAKE
        </Link>
      </div>
    </section>
  )
}

export default Composing
