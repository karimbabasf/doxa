'use client'

import { useCallback, useEffect, useState } from 'react'

/*
 * The control a judge presses. It lives on the floor screen, so unlike the shop page it
 * wears the DOXA tokens.
 *
 * Both directions are one press: break renames the price class on the shop page, restore
 * puts it back. Rehearsal runs the pair over and over, so the current state has to be
 * readable from across the room and the two actions have to be impossible to confuse.
 */

type BreakState = {
  broken: boolean
  changedAt: string
  priceClass: 'price' | 'cost'
}

const SETS = ['a', 'b', 'c']

export default function BreakButton({ className = '' }: { className?: string }) {
  const [state, setState] = useState<BreakState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = useCallback(async (method: 'GET' | 'POST' | 'DELETE') => {
    const res = await fetch('/api/demo/break', { method, cache: 'no-store' })
    if (!res.ok) throw new Error(`${method} returned ${res.status}`)
    return (await res.json()) as BreakState
  }, [])

  // Poll while idle so the readout cannot go stale behind a second window.
  useEffect(() => {
    let live = true
    const read = () => {
      send('GET')
        .then((next) => {
          if (live) setState(next)
        })
        .catch(() => {})
    }
    read()
    const timer = setInterval(read, 3000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [send])

  const press = useCallback(
    async (method: 'POST' | 'DELETE') => {
      setBusy(true)
      setError(null)
      try {
        setState(await send(method))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'the break route did not answer')
      } finally {
        setBusy(false)
      }
    },
    [send],
  )

  const broken = state?.broken ?? false
  const known = state !== null

  return (
    <section className={`border border-rule bg-ground-raised p-4 ${className}`}>
      <header className="flex items-baseline justify-between gap-4 border-b border-rule pb-2">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-dim">Demo target</h2>
        <span className="text-[11px] text-ink-faint">/demo/shop</span>
      </header>

      <div
        className="flex items-center gap-2 py-3"
        role="status"
        aria-live="polite"
      >
        <span
          aria-hidden
          className={`h-2 w-2 rounded-full ${
            !known ? 'bg-state-idle' : broken ? 'bg-state-fail' : 'bg-state-ok'
          }`}
        />
        <span className={`text-[13px] ${broken ? 'text-state-fail' : 'text-ink'}`}>
          {!known
            ? 'Reading the flag'
            : broken
              ? 'Broken. The page serves class=cost.'
              : 'Whole. The page serves class=price.'}
        </span>
      </div>

      <p className="pb-3 text-[11px] leading-relaxed text-ink-faint">
        The break renames one class. The text, the layout and the 200 response do not change,
        so the page still looks right to a reader.
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => press('POST')}
          disabled={busy || broken}
          className="flex-1 border border-state-fail px-3 py-2 text-[12px] uppercase tracking-[0.1em] text-state-fail hoverable hover:bg-state-fail hover:text-ground disabled:cursor-not-allowed disabled:border-rule disabled:text-ink-faint disabled:hover:bg-transparent disabled:hover:text-ink-faint"
        >
          Break the page
        </button>
        <button
          type="button"
          onClick={() => press('DELETE')}
          disabled={busy || (known && !broken)}
          className="flex-1 border border-state-ok px-3 py-2 text-[12px] uppercase tracking-[0.1em] text-state-ok hoverable hover:bg-state-ok hover:text-ground disabled:cursor-not-allowed disabled:border-rule disabled:text-ink-faint disabled:hover:bg-transparent disabled:hover:text-ink-faint"
        >
          Restore the page
        </button>
      </div>

      <div className="flex items-center justify-between gap-4 pt-3 text-[11px] text-ink-faint">
        <span className="flex gap-3">
          {SETS.map((s) => (
            <a
              key={s}
              href={`/demo/shop/${s}`}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-ink-dim"
            >
              set {s}
            </a>
          ))}
        </span>
        {state?.changedAt ? <span>changed {state.changedAt}</span> : null}
      </div>

      {error ? <p className="pt-2 text-[11px] text-state-fail">{error}</p> : null}
    </section>
  )
}
