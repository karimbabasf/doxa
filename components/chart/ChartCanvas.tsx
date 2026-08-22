'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { ChartNode } from '@/app/api/graph/route'
import { createLayout, step, type Layout } from '@/lib/graph/layout'
import { PLATE, blitFace, strikeFace } from './paintFace'

/**
 * The chart.
 *
 * Every opinion the factory has finished, placed by what it means. A node's position is not
 * decoration: the springs rest at the cosine distance between two embeddings, so two faces
 * sit close because the model put their sentences close. Nothing is bucketed by hand.
 *
 * The gestures are the ones people already have from Obsidian and every map: drag the
 * ground to move, wheel to zoom at the pointer, drag a face to pull it out and read around
 * it, hover to light up what it is joined to, click to open it.
 */

type Props = {
  nodes: ChartNode[]
  selectedId: string | null
  onSelect: (node: ChartNode | null) => void
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 3

/**
 * A face is a square and the layout thinks in circles, so the circle has to be the one
 * that contains the square, not the one inside it. Half a square's diagonal is its half
 * width times root two; anything less and two faces that settle diagonally to each other
 * overlap at the corners, which is what the first cut of this did.
 */
const CORNER = Math.SQRT2

/** Half the width of a face in world units, from how much work the run did. */
function halfWidthOf(node: ChartNode): number {
  return 22 + Math.min(16, Math.log10(Math.max(10, node.ops)) * 3.2)
}

/** The box every node sits inside, its own radius included. */
function boundsOf(layout: Layout): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (layout.nodes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of layout.nodes) {
    minX = Math.min(minX, n.x - n.r)
    minY = Math.min(minY, n.y - n.r)
    maxX = Math.max(maxX, n.x + n.r)
    maxY = Math.max(maxY, n.y + n.r)
  }
  return { minX, minY, maxX, maxY }
}

export function ChartCanvas({ nodes, selectedId, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Everything the animation loop touches lives in refs. State here would re-render the
  // whole screen sixty times a second to move some dots.
  const layoutRef = useRef<Layout | null>(null)
  const platesRef = useRef<Map<string, HTMLCanvasElement>>(new Map())
  const camRef = useRef({ x: 0, y: 0, zoom: 1 })
  const hoverRef = useRef<string | null>(null)
  const dragRef = useRef<{ kind: 'ground' | 'node'; id?: string; x: number; y: number } | null>(null)
  const movedRef = useRef(false)
  const framedRef = useRef(false)
  const selectedRef = useRef<string | null>(selectedId)

  selectedRef.current = selectedId

  useEffect(() => {
    if (nodes.length === 0) return
    layoutRef.current = createLayout(
      nodes.map((n) => n.id),
      nodes.map((n) => n.embedding),
      nodes.map((n) => halfWidthOf(n) * CORNER),
      { collidePad: 18 },
    )
    // Settle before the first paint. A graph that explodes outward on arrival reads as a
    // glitch, and the run it is showing already happened.
    for (let i = 0; i < 260; i++) step(layoutRef.current)

    const plates = new Map<string, HTMLCanvasElement>()
    for (const node of nodes) plates.set(node.id, strikeFace(node.face, '#070708'))
    platesRef.current = plates

    // Framing waits for the first frame that has a real canvas to frame into. Measuring
    // here would read a canvas the browser has not laid out yet, and the graph would open
    // at whatever zoom a zero-width viewport implies.
    framedRef.current = false
  }, [nodes])

  const toWorld = useCallback((screenX: number, screenY: number) => {
    const cam = camRef.current
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: (screenX - rect.left - rect.width / 2) / cam.zoom + cam.x,
      y: (screenY - rect.top - rect.height / 2) / cam.zoom + cam.y,
    }
  }, [])

  const nodeAt = useCallback((worldX: number, worldY: number): string | null => {
    const layout = layoutRef.current
    if (!layout) return null
    // Backwards, so the node drawn last (on top) is the one picked.
    for (let i = layout.nodes.length - 1; i >= 0; i--) {
      const n = layout.nodes[i]
      const half = n.r / CORNER
      if (Math.abs(worldX - n.x) <= half && Math.abs(worldY - n.y) <= half) return n.id
    }
    return null
  }, [])

  // The loop. One rAF for the whole screen, stopped on unmount.
  useEffect(() => {
    let frame = 0
    let live = true

    const draw = () => {
      if (!live) return
      frame = requestAnimationFrame(draw)

      const canvas = canvasRef.current
      const layout = layoutRef.current
      if (!canvas || !layout) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1))
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr
        canvas.height = height * dpr
      }

      // Two steps a frame keeps a dragged node's neighbours following without the whole
      // picture wandering while somebody is reading it.
      step(layout)
      step(layout)

      // Frame the settled cloud once, on the first frame with a canvas worth measuring.
      // The springs have no idea where the middle of a screen is, so a graph left at the
      // origin opens with its population shoved into one corner.
      if (!framedRef.current && width > 0 && height > 0) {
        const box = boundsOf(layout)
        if (box) {
          framedRef.current = true
          const pad = 110
          camRef.current = {
            x: (box.minX + box.maxX) / 2,
            y: (box.minY + box.maxY) / 2,
            zoom: Math.min(
              MAX_ZOOM,
              Math.max(
                MIN_ZOOM,
                Math.min(
                  (width - pad * 2) / Math.max(1, box.maxX - box.minX),
                  (height - pad * 2) / Math.max(1, box.maxY - box.minY),
                ),
              ),
            ),
          }
        }
      }

      const cam = camRef.current
      const hover = hoverRef.current
      const selected = selectedRef.current
      const focus = hover ?? selected

      const near = new Set<string>()
      if (focus) {
        const index = layout.nodes.findIndex((n) => n.id === focus)
        for (const edge of layout.edges) {
          if (edge.source === index) near.add(layout.nodes[edge.target].id)
          if (edge.target === index) near.add(layout.nodes[edge.source].id)
        }
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#0b0b0c'
      ctx.fillRect(0, 0, width, height)

      ctx.save()
      ctx.translate(width / 2, height / 2)
      ctx.scale(cam.zoom, cam.zoom)
      ctx.translate(-cam.x, -cam.y)

      for (const edge of layout.edges) {
        const a = layout.nodes[edge.source]
        const b = layout.nodes[edge.target]
        const lit = focus === null || focus === a.id || focus === b.id
        ctx.strokeStyle = lit
          ? `rgba(154,151,147,${0.14 + edge.strength * 0.5})`
          : `rgba(92,90,88,${0.05 + edge.strength * 0.08})`
        ctx.lineWidth = (lit ? 1.2 : 0.8) / cam.zoom
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }

      for (const n of layout.nodes) {
        const plate = platesRef.current.get(n.id)
        if (!plate) continue

        const dim = focus !== null && focus !== n.id && !near.has(n.id)
        ctx.globalAlpha = dim ? 0.3 : 1

        // The face is blitted at a whole multiple of its plate, so the dither never blurs.
        // Zoom sets which multiple, and the world transform is undone for the blit itself.
        // Floored, never rounded. Rounding up draws a face wider than the space the
        // layout kept for it, and every face then eats its neighbour's corner.
        const worldSize = (n.r / CORNER) * 2
        const scale = Math.max(1, Math.floor((worldSize * cam.zoom) / PLATE))

        ctx.save()
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        const sx = width / 2 + (n.x - cam.x) * cam.zoom
        const sy = height / 2 + (n.y - cam.y) * cam.zoom
        blitFace(ctx, plate, sx, sy, scale)

        if (n.id === selected || n.id === hover) {
          const box = PLATE * scale
          ctx.strokeStyle = n.id === selected ? '#e8e6e1' : '#9a9793'
          ctx.lineWidth = 1
          ctx.strokeRect(
            Math.round(sx - box / 2) - 2.5,
            Math.round(sy - box / 2) - 2.5,
            box + 5,
            box + 5,
          )
        }
        ctx.restore()
      }

      ctx.globalAlpha = 1
      ctx.restore()
    }

    frame = requestAnimationFrame(draw)
    return () => {
      live = false
      cancelAnimationFrame(frame)
    }
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const world = toWorld(e.clientX, e.clientY)
    const id = nodeAt(world.x, world.y)
    movedRef.current = false
    dragRef.current = { kind: id ? 'node' : 'ground', id: id ?? undefined, x: e.clientX, y: e.clientY }
    if (id) {
      const node = layoutRef.current?.nodes.find((n) => n.id === id)
      if (node) node.pinned = true
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag) {
      const world = toWorld(e.clientX, e.clientY)
      hoverRef.current = nodeAt(world.x, world.y)
      return
    }

    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedRef.current = true

    if (drag.kind === 'ground') {
      camRef.current.x -= dx / camRef.current.zoom
      camRef.current.y -= dy / camRef.current.zoom
    } else {
      const node = layoutRef.current?.nodes.find((n) => n.id === drag.id)
      if (node) {
        node.x += dx / camRef.current.zoom
        node.y += dy / camRef.current.zoom
        node.vx = 0
        node.vy = 0
      }
    }
    drag.x = e.clientX
    drag.y = e.clientY
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return

    if (drag.id) {
      const node = layoutRef.current?.nodes.find((n) => n.id === drag.id)
      // A dragged face stays where it was put. Somebody moved it there on purpose, and a
      // picture that springs back the moment you let go cannot be organised.
      if (node) node.pinned = movedRef.current
    }

    if (!movedRef.current) {
      const world = toWorld(e.clientX, e.clientY)
      const id = nodeAt(world.x, world.y)
      onSelect(id ? (nodes.find((n) => n.id === id) ?? null) : null)
    }
  }

  // Wheel zoom is bound by hand, because React's synthetic wheel listener is passive and
  // cannot stop the page scrolling behind the canvas.
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const cam = camRef.current
      const rect = canvas.getBoundingClientRect()
      const before = {
        x: (e.clientX - rect.left - rect.width / 2) / cam.zoom + cam.x,
        y: (e.clientY - rect.top - rect.height / 2) / cam.zoom + cam.y,
      }
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * Math.exp(-e.deltaY * 0.0016)))
      cam.zoom = next
      // Hold the point under the pointer still, which is what makes zoom feel like the
      // picture is being moved rather than replaced.
      cam.x = before.x - (e.clientX - rect.left - rect.width / 2) / next
      cam.y = before.y - (e.clientY - rect.top - rect.height / 2) / next
    }

    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div ref={wrapRef} className="chart-wrap">
      <canvas
        ref={canvasRef}
        className="chart-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          hoverRef.current = null
        }}
      />
    </div>
  )
}
