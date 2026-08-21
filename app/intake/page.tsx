'use client'

import { useCallback, useMemo, useState } from 'react'
import type { WorkOrder } from '@/lib/types'

/**
 * Intake. One field, because one opinion is the whole input to this factory.
 *
 * The limits are checked here and again in the route. The copy on both sides says the
 * same thing, so a person never fixes a problem the server then describes differently.
 */

const MIN_WORDS = 3
const MAX_CHARS = 500

const SAMPLES = [
  'Design reviews are theatre. They exist so that nobody has to be the person who said no.',
  'Remote work cut San Francisco office attendance by half after 2020, and the city still plans as if it will come back.',
  "Every good tool starts as somebody's private hack, and the ones that stay private stay good.",
]

/** The same cleaning the route does, so the counter agrees with the gate. */
function normalise(raw: string): string {
  return raw
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export default function IntakePage() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clean = useMemo(() => normalise(text), [text])
  const words = clean ? clean.split(' ').length : 0
  const tooShort = words < MIN_WORDS
  const tooLong = clean.length > MAX_CHARS
  const ready = !tooShort && !tooLong && !busy

  const local = tooLong
    ? `Cut ${clean.length - MAX_CHARS} characters. The limit is ${MAX_CHARS}.`
    : tooShort && words > 0
      ? `An opinion needs at least ${MIN_WORDS} words to assay. This one has ${words}.`
      : null

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
      <h1 className="text-[15px] tracking-[0.34em] text-ink">DOXA</h1>
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

      <div className="mt-14 border-t border-rule pt-5">
        <h2 className="text-[10px] tracking-[0.16em] text-ink-faint">
          OR TAKE ONE OF THESE. EACH ONE COMPOSES A DIFFERENT LINE.
        </h2>
        <ul className="mt-3 flex flex-col gap-2">
          {SAMPLES.map(sample => (
            <li key={sample}>
              <button
                type="button"
                onClick={() => {
                  setText(sample)
                  setError(null)
                }}
                className="hoverable prose-sans w-full border border-rule px-4 py-3 text-left text-ink-dim hover:border-rule-bright hover:text-ink"
                style={{ fontSize: '12.5px' }}
              >
                {sample}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}
