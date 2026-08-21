'use client'

import { useEffect, useRef, useState } from 'react'
import type { DiveOperator, DivePayload } from '@/app/api/dive/[batchId]/route'
import { specimenCanvas } from './specimenPaint'

/**
 * The pipeline behind one node.
 *
 * This is the screen that has to answer "what did it actually do", so every card is a
 * readback: the operator that ran, in the layer the floor ran it in, the numbers it
 * measured, the render parameter it wrote and how loudly, and for the field wing the
 * pages it read. The planner's own words for why it picked the operator sit under it.
 * There is no summary here that the run did not produce.
 */

const WING_LABEL: Record<string, string> = {
  forensics: 'FORENSICS',
  semantics: 'SEMANTICS',
  esoteric: 'ESOTERIC',
  field: 'FIELD',
}

/**
 * Every number on this panel goes through here.
 *
 * Float arithmetic prints `field.scale` as 0.9091999999999998, which is the true stored
 * value and still the wrong thing to show: it is fifteen digits of noise around a reading
 * measured to three, and it wraps the row it sits in. Three decimals is the precision the
 * operators actually claim. Whole numbers and identifiers pass through untouched, because
 * a seed rounded to three decimals would be a different seed.
 */
function formatValue(value: number | string | boolean): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'string') return value
  if (Number.isInteger(value)) return String(value)
  if (Math.abs(value) >= 1000) return value.toFixed(0)
  return value.toFixed(3)
}

function SpecimenPlate({ payload }: { payload: DivePayload }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const plate = specimenCanvas(payload.params, 256, { opaqueGround: true })
    plate.style.width = '100%'
    plate.style.height = 'auto'
    plate.style.display = 'block'
    plate.style.imageRendering = 'pixelated'
    host.replaceChildren(plate)
  }, [payload])

  return <div ref={hostRef} className="dive-plate" aria-hidden="true" />
}

function OperatorCard({ op, index }: { op: DiveOperator; index: number }) {
  const readings = Object.entries(op.readings)
  return (
    <article
      className="dive-op"
      data-wing={op.wing}
      style={{ animationDelay: `${Math.min(index * 34, 420)}ms` }}
    >
      <header className="dive-op-head">
        <span className="dive-op-id">{op.id}</span>
        <span className="dive-op-wing">{WING_LABEL[op.wing] ?? op.wing}</span>
      </header>

      {readings.length > 0 && (
        <dl className="dive-readings">
          {readings.map(([key, value]) => (
            <div key={key} className="dive-reading">
              <dt>{key}</dt>
              <dd>{formatValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}

      {op.contributions.length > 0 && (
        <ul className="dive-writes">
          {op.contributions.map((c) => (
            <li key={c.path}>
              <span className="dive-path">{c.path}</span>
              <span className="dive-value">{formatValue(c.value)}</span>
              <span className="dive-weight">w {c.weight.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      )}

      {op.evidence.length > 0 && (
        <ul className="dive-evidence">
          {op.evidence.slice(0, 3).map((e, i) => (
            <li key={`${e.url}-${i}`}>
              <span className="dive-source">{e.source}</span>
              <span className="dive-snippet">{e.snippet}</span>
            </li>
          ))}
          {op.evidence.length > 3 && (
            <li className="dive-more">plus {op.evidence.length - 3} more rows</li>
          )}
        </ul>
      )}

      {op.rationale && <p className="dive-why">{op.rationale}</p>}

      <footer className="dive-op-foot">
        <span>{op.ops.toLocaleString()} ops</span>
        {op.needs.length > 0 && <span>needs {op.needs.join(', ')}</span>}
      </footer>
    </article>
  )
}

export function DivePanel({
  batchId,
  onClose,
}: {
  batchId: string
  onClose: () => void
}) {
  const [payload, setPayload] = useState<DivePayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setPayload(null)
    setError(null)
    fetch(`/api/dive/${batchId}`)
      .then(async (res) => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? `request failed, ${res.status}`)
        return body as DivePayload
      })
      .then((body) => live && setPayload(body))
      .catch((err: Error) => live && setError(err.message))
    return () => {
      live = false
    }
  }, [batchId])

  // Escape closes. A dive is a place you are inside, so it needs a way out that does
  // not require finding a control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  let running = 0

  return (
    <aside className="dive" role="dialog" aria-label={`Pipeline for batch ${batchId}`}>
      <button className="dive-close" onClick={onClose} aria-label="Close pipeline">
        esc
      </button>

      {error && <p className="dive-error">{error}</p>}
      {!payload && !error && <p className="dive-loading">Reading the run.</p>}

      {payload && (
        <>
          <header className="dive-head">
            <div className="dive-meta">
              <span className="dive-batch">{payload.batchId}</span>
              <span>{payload.totalOps.toLocaleString()} operations</span>
              <span>{payload.layers.flat().length} operators</span>
              <span>{payload.layers.length} layers</span>
            </div>
            <blockquote className="dive-opinion">{payload.opinion}</blockquote>

            {/* Stated at the top, not buried. A specimen struck with a wing missing is
                still a specimen, and the only way to know is to be told. */}
            {payload.notRun.length > 0 && (
              <p className="dive-missing">
                {payload.notRun.length === 1 ? 'One operator was' : `${payload.notRun.length} operators were`}{' '}
                signed and returned nothing:{' '}
                {payload.notRun.map((o) => o.id).join(', ')}. The specimen below was struck
                without {payload.notRun.length === 1 ? 'it' : 'them'}.
              </p>
            )}
            {payload.plannerNotes && (
              <details className="dive-planner">
                <summary>Why the planner composed this line</summary>
                <p>{payload.plannerNotes}</p>
              </details>
            )}
          </header>

          <div className="dive-layers">
            {payload.layers.map((layer, i) => {
              const start = running
              running += layer.length
              return (
                <section key={i} className="dive-layer">
                  <h2 className="dive-layer-head">
                    <span>LAYER {String(i + 1).padStart(2, '0')}</span>
                    <span className="dive-layer-note">
                      {layer.length} at once
                    </span>
                  </h2>
                  <div className="dive-layer-ops">
                    {layer.map((op, j) => (
                      <OperatorCard key={op.id} op={op} index={start + j} />
                    ))}
                  </div>
                </section>
              )
            })}

            <section className="dive-layer dive-layer-out">
              <h2 className="dive-layer-head">
                <span>SPECIMEN</span>
                <span className="dive-layer-note">seed {payload.params.seed}</span>
              </h2>
              <SpecimenPlate payload={payload} />
              <dl className="dive-readings dive-plate-params">
                <div className="dive-reading">
                  <dt>field</dt>
                  <dd>{payload.params.field.type}</dd>
                </div>
                <div className="dive-reading">
                  <dt>primitives</dt>
                  <dd>
                    {payload.params.primitives.count} {payload.params.primitives.arrangement}
                  </dd>
                </div>
                <div className="dive-reading">
                  <dt>dither</dt>
                  <dd>
                    {payload.params.dither.matrix}x, {payload.params.dither.levels} levels
                  </dd>
                </div>
                <div className="dive-reading">
                  <dt>ink</dt>
                  <dd>{payload.params.palette.ink}</dd>
                </div>
              </dl>
              <a className="dive-cert" href={`/certificate/${payload.batchId}`}>
                Full certificate
              </a>
            </section>
          </div>
        </>
      )}
    </aside>
  )
}
