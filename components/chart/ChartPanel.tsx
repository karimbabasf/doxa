'use client'

import type { ChartNode } from '@/app/api/graph/route'
import { PLAIN_WING } from '@/lib/planLanguage'
import type { Wing } from '@/lib/types'
import { FaceTile } from './FaceTile'

/**
 * One opinion, opened.
 *
 * The order is the order somebody asks in: what does this look like, what did it say, what
 * was done to it, did anything go wrong, when was it. Nothing else goes in here. Every
 * count, id and score the run produced is real and interesting to the person who built the
 * factory, and it is noise to the person who typed a sentence into it.
 */

const WING_ORDER: Wing[] = ['forensics', 'field', 'semantics', 'esoteric']

function said(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

export function ChartPanel({ node, onClose }: { node: ChartNode; onClose: () => void }) {
  const healed = node.tools.filter((t) => t.healed)
  const byWing = WING_ORDER.map((wing) => ({
    wing,
    tools: node.tools.filter((t) => t.wing === wing),
  })).filter((group) => group.tools.length > 0)

  return (
    <aside className="chart-panel" key={node.id}>
      <button className="chart-close" onClick={onClose} aria-label="Close">
        &#215;
      </button>

      <div className="chart-panel-face">
        <FaceTile face={node.face} box={180} />
      </div>

      <blockquote className="chart-said">{node.opinion}</blockquote>

      <section className="chart-block">
        <h2>What was done to it</h2>
        {byWing.map((group) => (
          <div className="chart-group" key={group.wing}>
            <h3>{PLAIN_WING[group.wing].name}</h3>
            <p>{PLAIN_WING[group.wing].line}</p>
            <ul>
              {group.tools.map((tool) => (
                <li key={tool.id} title={tool.what}>
                  {tool.name}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="chart-block">
        <h2>Did anything go wrong</h2>
        {healed.length === 0 && node.missing.length === 0 ? (
          <p>Nothing broke. Every check finished on its first try.</p>
        ) : (
          <>
            {healed.map((tool) => (
              <p key={tool.id}>
                <b>{tool.name}</b> hit a problem and fixed itself. {tool.healed}
              </p>
            ))}
            {node.missing.length > 0 && (
              <p>
                {node.missing.length === 1
                  ? `${node.missing[0]} was planned but never reported.`
                  : `${node.missing.join(', ')} were planned but never reported.`}
              </p>
            )}
          </>
        )}
      </section>

      <p className="chart-when">{said(node.createdAt)}</p>
    </aside>
  )
}
