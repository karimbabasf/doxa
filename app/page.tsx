'use client'

import { useCallback, useEffect, useState } from 'react'
import { GraphCanvas } from '@/components/graph/GraphCanvas'
import { DivePanel } from '@/components/graph/DivePanel'
import type { GraphNode } from './api/graph/route'

/**
 * The graph.
 *
 * It opens empty and fills, one opinion at a time, because that is the honest order of
 * events: each arrival re-runs the nearest neighbour search over everything present, so
 * edges form and edges break as the population changes. Watching it fill is watching the
 * embedding space sort itself out, which is the one thing a static screenshot of a
 * finished graph cannot show.
 */

/** Gap between arrivals. Slow enough to watch an edge break, quick enough to sit through. */
const ARRIVAL_MS = 620

export default function GraphPage() {
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [admitted, setAdmitted] = useState(0)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/graph')
      .then(async (res) => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? `request failed, ${res.status}`)
        return body.nodes as GraphNode[]
      })
      .then((list) => {
        if (!live) return
        setNodes(list)
        // `?open=<batchId>` lands straight in one node's pipeline. A dive is the part
        // worth sending someone, and a link that only ever opens the whole graph makes
        // the sender describe with words what the screen already shows.
        const wanted = new URLSearchParams(window.location.search).get('open')
        if (!wanted) return
        const match = list.find((n) => n.batchId === wanted)
        if (match) {
          setAdmitted(list.length)
          setSelected(match)
        }
      })
      .catch((err: Error) => live && setError(err.message))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (nodes.length === 0 || admitted >= nodes.length) return
    const reduceMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (reduceMotion) {
      setAdmitted(nodes.length)
      return
    }
    const timer = setTimeout(() => setAdmitted((n) => n + 1), ARRIVAL_MS)
    return () => clearTimeout(timer)
  }, [nodes, admitted])

  const onSelect = useCallback((node: GraphNode | null) => setSelected(node), [])

  const filling = nodes.length > 0 && admitted < nodes.length

  return (
    <main className="graph-view" data-diving={selected ? 'yes' : 'no'}>
      <GraphCanvas
        nodes={nodes}
        selectedId={selected?.batchId ?? null}
        onSelect={onSelect}
        admitted={admitted}
      />

      <div className="graph-top">
        <span className="graph-mark">DOXA</span>
        <span className="graph-count">
          {admitted} of {nodes.length} opinions
          {filling ? ', filling' : ''}
        </span>
        <a className="graph-add" href="/intake">
          Add an opinion
        </a>
      </div>

      {error && <p className="graph-error">{error}</p>}

      {nodes.length === 0 && !error && (
        <p className="graph-empty">
          No analysed opinions yet. Run one through intake and it lands here.
        </p>
      )}

      {!selected && admitted > 0 && (
        <p className="graph-hint">
          Every node is the specimen its own run struck. Distance is the distance between
          the opinions. Click one to see the line that made it.
        </p>
      )}

      {selected && (
        <DivePanel batchId={selected.batchId} onClose={() => setSelected(null)} />
      )}

      {/* Text equivalent of the canvas, and the keyboard route into a dive. */}
      <ul className="sr-list" aria-label="Every analysed opinion">
        {nodes.slice(0, admitted).map((n) => (
          <li key={n.batchId}>
            <button onClick={() => setSelected(n)}>
              {n.batchId}: {n.opinion}
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
