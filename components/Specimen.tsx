'use client'

/**
 * The specimen, painted in the browser from the same functions the server strikes
 * the PNG with, plus the attribution readout.
 *
 * Hovering a pixel answers one question: which assays shaped what is under the
 * pointer. The answer comes from the merge's attribution map, so a parameter that
 * several operators averaged reports as blended instead of crediting the loudest
 * one for a value it did not produce alone.
 */

import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SIZE, INK, renderSpecimen } from '@/lib/foundry/render'
import type { Attribution } from '@/lib/foundry/merge'
import type { RenderParams, RenderPath } from '@/lib/types'

type Props = {
  params: RenderParams
  attribution: Attribution
  /** Pixel buffer size. Defaults to the size the certificate strikes the PNG at. */
  renderSize?: number
}

type Reading = {
  /** Position in the canvas box, in CSS pixels, for placing the readout. */
  left: number
  top: number
  flip: boolean
  x: number
  y: number
  ink: boolean
  zone: string
  paths: RenderPath[]
}

const FRAME_PATHS: RenderPath[] = ['frame.fill', 'frame.bleed']
const FIELD_PATHS: RenderPath[] = [
  'field.type',
  'field.scale',
  'primitives.count',
  'primitives.arrangement',
]

/** Local, because the encoder that owns the other hex parser is Node only. */
function toRgb(value: string, fallback: [number, number, number]): [number, number, number] {
  const hex = String(value ?? '').trim().replace(/^#/, '')
  const full = hex.length === 3 ? hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] : hex
  if (!/^[0-9a-f]{6}$/i.test(full)) return fallback
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

function valueAt(params: RenderParams, path: RenderPath): number | string | boolean {
  if (path === 'seed') return params.seed
  const [group, leaf] = path.split('.')
  const bag = params[group as 'field' | 'primitives' | 'dither' | 'palette' | 'frame'] as Record<
    string,
    number | string | boolean
  >
  return bag?.[leaf]
}

function formatValue(value: number | string | boolean | undefined): string {
  if (value === undefined) return 'unset'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3)
  return value
}

const MODE_CLASS: Record<string, string> = {
  sole: 'text-ink-faint',
  blended: 'text-signal',
  contested: 'text-signal underline decoration-dotted underline-offset-2',
}

export function Specimen({ params, attribution, renderSize = DEFAULT_SIZE }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pixelsRef = useRef<Uint8Array | null>(null)
  const [reading, setReading] = useState<Reading | null>(null)
  const [painted, setPainted] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const n = Math.max(1, Math.round(renderSize))
    const context = canvas.getContext('2d')
    if (!context) return

    const pixels = renderSpecimen(params, n)
    pixelsRef.current = pixels

    const ink = toRgb(params.palette.ink, [232, 230, 225])
    const ground = toRgb(params.palette.ground, [11, 11, 12])
    const image = context.createImageData(n, n)
    for (let i = 0; i < pixels.length; i++) {
      const c = pixels[i] === INK ? ink : ground
      const at = i * 4
      image.data[at] = c[0]
      image.data[at + 1] = c[1]
      image.data[at + 2] = c[2]
      image.data[at + 3] = 255
    }
    context.putImageData(image, 0, 0)
    setPainted(true)
  }, [params, renderSize])

  const onMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const pixels = pixelsRef.current
    if (!canvas || !pixels) return

    const box = canvas.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return
    const n = Math.max(1, Math.round(renderSize))
    const localX = event.clientX - box.left
    const localY = event.clientY - box.top
    const x = Math.min(n - 1, Math.max(0, Math.floor((localX / box.width) * n)))
    const y = Math.min(n - 1, Math.max(0, Math.floor((localY / box.height) * n)))

    // The same test the renderer uses for its vignette, so the zone the readout
    // names is the zone that actually shaped this pixel.
    const ux = ((x + 0.5) / n) * 2 - 1
    const uy = ((y + 0.5) / n) * 2 - 1
    const radius = Math.sqrt(ux * ux + uy * uy)
    const inFrame = !params.frame.bleed && radius >= params.frame.fill

    const ink = pixels[y * n + x] === INK
    const paths: RenderPath[] = [
      ...(inFrame ? FRAME_PATHS : FIELD_PATHS),
      ink ? 'palette.ink' : 'palette.ground',
      'dither.matrix',
    ]

    setReading({
      left: localX,
      top: localY,
      flip: localX > box.width * 0.55,
      x,
      y,
      ink,
      zone: inFrame ? 'frame band' : 'field',
      paths,
    })
  }

  return (
    <div className="relative w-full max-w-[512px]">
      <canvas
        ref={canvasRef}
        width={renderSize}
        height={renderSize}
        aria-label="The specimen struck from this batch. Hover it to read which assay shaped a pixel."
        onPointerMove={onMove}
        onPointerLeave={() => setReading(null)}
        className="w-full border border-rule bg-ground-sunk print:hidden"
        style={{
          imageRendering: 'pixelated',
          aspectRatio: '1 / 1',
          opacity: painted ? 1 : 0,
          transition: 'opacity 420ms var(--ease-out)',
        }}
      />

      {reading ? (
        <div
          className="pointer-events-none absolute z-10 w-[19rem] border border-rule-bright bg-ground-raised px-3 py-2 text-[11px] leading-relaxed shadow-lg print:hidden"
          style={{
            left: reading.left,
            top: reading.top,
            transform: `translate(${reading.flip ? 'calc(-100% - 12px)' : '12px'}, 12px)`,
          }}
        >
          <div className="flex items-baseline justify-between border-b border-rule pb-1 text-ink-dim">
            <span>
              {reading.x}, {reading.y} . {reading.ink ? 'ink' : 'ground'}
            </span>
            <span className="text-ink-faint">{reading.zone}</span>
          </div>

          <dl className="mt-1 space-y-1">
            {reading.paths.map(path => {
              const entry = attribution[path]
              return (
                <div key={path}>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-ink">{path}</dt>
                    <dd className="text-ink-dim">{formatValue(valueAt(params, path))}</dd>
                  </div>
                  <div className="text-ink-faint">
                    {entry ? (
                      <>
                        <span className={MODE_CLASS[entry.mode] ?? 'text-ink-faint'}>{entry.mode}</span>
                        {': '}
                        {entry.contributors
                          .map(c => `${c.operatorId} at ${c.weight.toFixed(2)}`)
                          .join(', ')}
                      </>
                    ) : (
                      'no contributor recorded for this parameter'
                    )}
                  </div>
                </div>
              )
            })}
          </dl>

          <p className="mt-2 border-t border-rule pt-1 text-ink-faint">
            Every parameter and every contributor is listed below.
          </p>
        </div>
      ) : null}
    </div>
  )
}

export default Specimen
