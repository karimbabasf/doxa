'use client'

import { useEffect, useState } from 'react'
import type { ChartNode } from '../api/graph/route'
import { ChartCanvas, type Arrangement } from '@/components/chart/ChartCanvas'
import { ChartPanel } from '@/components/chart/ChartPanel'

/**
 * The chart.
 *
 * The one screen anybody can open without knowing what any of this is. It answers one
 * question, which is where an opinion sits among all the others, and it answers it by
 * showing rather than explaining.
 *
 * Four ways to sort it, named as questions rather than as fields, because the reader has a
 * question and not a schema.
 */

const WAYS: { id: Arrangement; label: string }[] = [
  { id: 'meaning', label: 'SUBJECT' },
  { id: 'feeling', label: 'FEELING' },
  { id: 'certainty', label: 'CERTAINTY' },
  { id: 'time', label: 'WHEN' },
]

const SAID: Record<Arrangement, string> = {
  meaning: 'Every square is one opinion, drawn from what was measured in it. The ones about the same thing sit together. Click one to read it.',
  feeling: 'Laid out by how the opinion feels about its subject, from against it on the left to for it on the right.',
  certainty: 'Laid out by how sure the opinion sounds, from hedged on the left to flatly certain on the right.',
  time: 'Laid out by when it was put through, oldest on the left.',
}

export default function ChartPage() {
  const [nodes, setNodes] = useState<ChartNode[] | null>(null)
  const [selected, setSelected] = useState<ChartNode | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [way, setWay] = useState<Arrangement>('meaning')

  useEffect(() => {
    let live = true
    fetch('/api/graph')
      .then(async (res) => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? `the chart could not be read, ${res.status}`)
        return body.nodes as ChartNode[]
      })
      .then((list) => {
        if (!live) return
        setNodes(list)
        // `?open=<id>` lands straight on one opinion, so a link to a run is a link to the
        // thing itself and not to a screen the reader has to search. `?sort=` does the same
        // for the arrangement, so a link can be to a question rather than to a chart.
        const params = new URLSearchParams(window.location.search)
        const wanted = params.get('open')
        if (wanted) setSelected(list.find((n) => n.id === wanted) ?? null)
        const sort = params.get('sort')
        if (sort && WAYS.some((option) => option.id === sort)) setWay(sort as Arrangement)
      })
      .catch((err: unknown) => {
        if (live) setProblem(err instanceof Error ? err.message : String(err))
      })
    return () => {
      live = false
    }
  }, [])

  return (
    <main className="chart">
      <div className="chart-bar">
        <a className="gate-mark" href="/">
          DOXA
        </a>
        <span className="chart-count">
          {nodes === null
            ? 'OPENING'
            : nodes.length === 0
              ? 'NOTHING HAS BEEN PUT THROUGH YET'
              : `${nodes.length} ${nodes.length === 1 ? 'OPINION' : 'OPINIONS'}`}
        </span>

        {nodes !== null && nodes.length > 1 && (
          <div className="chart-ways">
            {WAYS.map((option) => (
              <button
                key={option.id}
                className="chart-way"
                aria-pressed={way === option.id}
                onClick={() => setWay(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {problem && <p className="gate-missing chart-problem">{problem}</p>}

      {nodes !== null && nodes.length > 0 && (
        <ChartCanvas
          nodes={nodes}
          selectedId={selected?.id ?? null}
          onSelect={setSelected}
          arrangement={way}
        />
      )}

      {nodes !== null && nodes.length === 0 && !problem && (
        <p className="chart-empty">
          Put an opinion through and it turns up here, next to the ones that mean something
          close to it.
        </p>
      )}

      {selected && <ChartPanel node={selected} onClose={() => setSelected(null)} />}

      {nodes !== null && nodes.length > 0 && !selected && (
        <p className="chart-hint" key={way}>
          {SAID[way]}
        </p>
      )}
    </main>
  )
}
