'use client'

import { useEffect, useState } from 'react'
import type { ChartNode } from '../api/graph/route'
import { ChartCanvas } from '@/components/chart/ChartCanvas'
import { ChartPanel } from '@/components/chart/ChartPanel'

/**
 * The chart.
 *
 * The one screen anybody can open without knowing what any of this is. It answers one
 * question, which is where an opinion sits among all the others, and it answers it by
 * showing rather than explaining.
 */

export default function ChartPage() {
  const [nodes, setNodes] = useState<ChartNode[] | null>(null)
  const [selected, setSelected] = useState<ChartNode | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

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
        // thing itself and not to a screen the reader has to search.
        const wanted = new URLSearchParams(window.location.search).get('open')
        if (wanted) setSelected(list.find((n) => n.id === wanted) ?? null)
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
      </div>

      {problem && <p className="gate-missing chart-problem">{problem}</p>}

      {nodes !== null && nodes.length > 0 && (
        <ChartCanvas nodes={nodes} selectedId={selected?.id ?? null} onSelect={setSelected} />
      )}

      {nodes !== null && nodes.length === 0 && !problem && (
        <p className="chart-empty">
          Put an opinion through and it turns up here, next to the ones that mean something
          close to it.
        </p>
      )}

      {selected && <ChartPanel node={selected} onClose={() => setSelected(null)} />}

      {nodes !== null && nodes.length > 0 && !selected && (
        <p className="chart-hint">
          Every square is one opinion, drawn from what was measured in it. Two sit close when
          they mean something close. Click one to read it.
        </p>
      )}
    </main>
  )
}
