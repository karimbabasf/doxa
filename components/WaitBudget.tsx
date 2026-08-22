'use client'

import { useMemo } from 'react'
import { layer } from '@/lib/executor/topo'
import { plainName } from '@/lib/planLanguage'
import type { Wing } from '@/lib/types'
import { Bar, BarChart, type DitherColor, Tooltip, XAxis, YAxis } from './dither-kit'
import type { GateOperator } from './OperatorCard'

/**
 * Where the wait actually goes.
 *
 * The gate used to state the estimate as a bare number in the footer, which answers
 * "how long" and nothing else. The more useful question at a gate is "why that long",
 * and the answer is the shape of the plan rather than the size of it.
 *
 * The total in `plan.ts` is the sum over layers of the slowest operator in each layer,
 * because everything inside a layer runs at once. So the bars are built the same way it
 * is: one bar per layer, as tall as that layer's slowest instrument, coloured by that
 * instrument's wing. Anything else here, a sum by wing being the obvious trap, would
 * draw a total that disagrees with the number printed underneath it.
 *
 * The drawing is dither-kit's. What is local is the arithmetic, which is the part that
 * has to agree with the planner.
 */

type Props = {
  operators: GateOperator[]
}

/** The kit's palette names, mapped to the wings. Field is the signal orange. */
const WING_DITHER: Record<Wing, DitherColor> = {
  field: 'orange',
  forensics: 'grey',
  semantics: 'blue',
  esoteric: 'purple',
}

const secs = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`)

export function WaitBudget({ operators }: Props) {
  const { rows, total, pace } = useMemo(() => {
    if (operators.length === 0) return { rows: [], total: 0, pace: null }

    let layers: GateOperator[][]
    try {
      layers = layer(operators)
    } catch {
      // A cycle is the planner's bug, not this chart's. The rest of the gate still draws.
      return { rows: [], total: 0, pace: null }
    }

    const paced = layers.map((group, index) => {
      const slowest = group.reduce((worst, op) => (op.estMs > worst.estMs ? op : worst))
      return {
        layer: `L${index + 1}`,
        ms: slowest.estMs,
        wing: slowest.wing,
        count: group.length,
        slowest,
      }
    })

    const sum = paced.reduce((n, row) => n + row.ms, 0)
    const worst = paced.reduce((a, b) => (b.ms > a.ms ? b : a))
    return { rows: paced, total: sum, pace: worst }
  }, [operators])

  if (rows.length === 0 || pace === null) return null

  // One series, so the bars take the wing of whichever instrument sets the longest
  // layer. A per-bar colour would need one series per wing and a stack of mostly
  // empty columns, which reads as four measurements where there is one.
  const config = { ms: { label: 'Slowest tool in the layer', color: WING_DITHER[pace.wing] } }

  return (
    <section className="budget" aria-label="Where the wait goes">
      <div className="budget-head">
        <span className="budget-cap">THE WAIT, LAYER BY LAYER</span>
        <span className="budget-total">{secs(total)} end to end</span>
      </div>

      <div className="budget-plot">
        <BarChart data={rows} config={config} margins={{ top: 6, right: 6, bottom: 18, left: 38 }}>
          <YAxis />
          <XAxis dataKey="layer" />
          <Bar dataKey="ms" variant="gradient" />
          <Tooltip />
        </BarChart>
      </div>

      <p className="budget-note">
        Everything inside a layer runs at once, so the wait is set by the slowest tool in each
        layer and not by adding them up. The tallest bar here is{' '}
        {plainName(pace.slowest.id, pace.slowest.name)} at {secs(pace.ms)}.
      </p>
    </section>
  )
}

export default WaitBudget
