'use client'

import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'
import { MAX_CHARS, MIN_WORDS, countWords, normalise } from '@/lib/intake'
import type { WorkOrder } from '@/lib/types'

/**
 * The front door. One field, because one opinion is the whole input to this factory.
 *
 * Under the field, the samples roll instead of sitting in a list. A static list of three
 * reads as three options to be weighed. A slow column reads as a supply of them, which is
 * the truer claim: any opinion goes in here, and these are only the ones nearest to hand.
 */

/**
 * Nine, not three. A short loop is visibly a loop within about twelve seconds and stops
 * reading as a supply. They are spread on purpose across the kinds of claim that compose
 * visibly different lines: a claim carrying a date and a place pulls the field wing out to
 * the network, a bare aesthetic claim never leaves the machine.
 */
const SAMPLES = [
  'Design reviews are theatre. They exist so that nobody has to be the person who said no.',
  'Remote work cut San Francisco office attendance by half after 2020, and the city still plans as if it will come back.',
  "Every good tool starts as somebody's private hack, and the ones that stay private stay good.",
  'A codebase with no dead code in it is a codebase nobody has been brave in.',
  'The best interfaces are the ones you stop noticing by the second week.',
  'Open source solved distribution and never solved paying the people who maintain it.',
  'Most meetings are a request for permission wearing the clothes of a request for input.',
  'Typography is the only part of design a reader feels without ever looking at it.',
  'Every company that says it is data driven means it is driven by the four numbers it happens to collect.',
]

/** Seconds of travel per row. Slow enough to finish a sentence before it leaves. */
const ROW_SECONDS = 3.5

export default function HomePage() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clean = useMemo(() => normalise(text), [text])
  const words = countWords(clean)
  const tooShort = words < MIN_WORDS
  const tooLong = clean.length > MAX_CHARS
  const ready = !tooShort && !tooLong && !busy

  const local = tooLong
    ? `Cut ${clean.length - MAX_CHARS} characters. The limit is ${MAX_CHARS}.`
    : tooShort && words > 0
      ? `An opinion needs at least ${MIN_WORDS} words to assay. This one has ${words}.`
      : null

  const take = useCallback((sample: string) => {
    setText(sample)
    setError(null)
    document.getElementById('opinion')?.focus()
  }, [])

  const submit = useCallback(async () => {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ opinion: clean }),
      })
      const body = (await res.json()) as WorkOrder & { error?: string }
      if (!res.ok) {
        setError(body.error ?? `Intake refused the opinion with status ${res.status}.`)
        setBusy(false)
        return
      }
      window.location.assign(`/gate/${body.batchId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }, [clean, ready])

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-[15px] tracking-[0.34em] text-ink">DOXA</h1>
        <Link
          href="/graph"
          className="text-[10px] tracking-[0.14em] text-ink-faint no-underline hover:text-ink"
        >
          THE GRAPH
        </Link>
      </div>
      <p className="prose-sans mt-3 max-w-xl text-ink-dim" style={{ fontSize: '13px' }}>
        An opinion goes in. A planner agent picks the instruments that suit that exact text and
        writes down why it picked each one. You read the plan and sign it. The line runs under
        tracing and strikes one dithered specimen with a certificate of every operation performed.
      </p>

      <label htmlFor="opinion" className="mt-10 block text-[10px] tracking-[0.16em] text-ink-faint">
        THE OPINION
      </label>
      <textarea
        id="opinion"
        value={text}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void submit()
          }
        }}
        rows={5}
        autoFocus
        spellCheck
        placeholder="Type the thing you actually believe. Three words at least, 500 characters at most."
        className="prose-sans mt-2 w-full resize-y border border-rule bg-ground-sunk px-4 py-3 text-ink outline-none focus:border-signal"
        style={{ fontSize: '15px', lineHeight: 1.55 }}
      />

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3 text-[10px]">
        <span className={tooLong ? 'text-state-fail' : 'text-ink-faint'}>
          {words} {words === 1 ? 'word' : 'words'}, {clean.length} of {MAX_CHARS} characters
        </span>
        <span className="text-ink-faint">Cmd or Ctrl plus Enter composes the work order.</span>
      </div>

      {(local || error) && (
        <p className="mt-3 border-l-2 border-state-fail pl-3 text-[12px] text-state-fail">
          {error ?? local}
        </p>
      )}

      <div className="mt-6 flex items-center gap-4">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!ready}
          className={`border px-5 py-2 text-[11px] tracking-[0.14em] ${
            ready
              ? 'cursor-pointer border-signal bg-signal text-ground'
              : 'cursor-not-allowed border-rule text-ink-faint'
          }`}
        >
          COMPOSE THE WORK ORDER
        </button>
        {busy && (
          <span className="is-live text-[11px] text-state-live">
            The planner is reading your text and choosing instruments.
          </span>
        )}
      </div>

      {/*
        The roll. Two copies of the list on one track, translated by half the track's own
        height, so the seam lands on a row boundary whatever the rows measure. Hover and
        keyboard focus both stop it: nobody can reliably hit a moving target, and a
        suggestion nobody can click is decoration.
      */}
      <section
        className="suggest mt-12"
        aria-label="Sample opinions"
        style={{ ['--suggest-dur' as string]: `${SAMPLES.length * ROW_SECONDS}s` }}
      >
        <div className="suggest-track">
          {SAMPLES.map(sample => (
            <button key={sample} type="button" className="suggest-row" onClick={() => take(sample)}>
              {sample}
            </button>
          ))}
          {/* The second pass exists only to hide the seam. It is not for a reader. */}
          <div className="suggest-dup" aria-hidden="true">
            {SAMPLES.map(sample => (
              <button
                key={sample}
                type="button"
                tabIndex={-1}
                className="suggest-row"
                onClick={() => take(sample)}
              >
                {sample}
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
