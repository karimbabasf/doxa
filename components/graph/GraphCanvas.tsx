'use client'

import { useEffect, useRef } from 'react'
import {
  addNode,
  bounds,
  createLayout,
  step,
  type Layout,
} from '@/lib/graph/layout'
import {
  focusOn,
  frameBox,
  stepCamera,
  toWorld,
  type Camera,
} from '@/lib/graph/camera'
import { radiusForOps, specimenCanvas } from './specimenPaint'
import type { GraphNode } from '@/app/api/graph/route'

export type GraphCanvasProps = {
  nodes: GraphNode[]
  /** Batch id of the node being examined, or null for the whole graph. */
  selectedId: string | null
  onSelect: (node: GraphNode | null) => void
  /** How many opinions have been admitted so far. The floor drives this. */
  admitted: number
}

const BACKGROUND = '#07090d'
const EDGE = '#5f6b84'
const LABEL = '#8d95a6'

/**
 * The opinion graph.
 *
 * Everything on this canvas is a readout. A node is the specimen that run struck, sized by
 * the operations that run performed. An edge exists because one of its two opinions is
 * among the other's three nearest in embedding space, and its opacity is that cosine
 * similarity. Nothing is placed by hand and nothing is decorative, so a clump on screen is
 * a claim about the text that can be checked by reading the two opinions inside it.
 */
export function GraphCanvas({ nodes, selectedId, onSelect, admitted }: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Mutable simulation state, kept off React so a 60Hz loop never triggers a render.
  const live = useRef<{
    layout: Layout
    camera: Camera
    target: Camera
    hover: string | null
    viewport: { width: number; height: number }
    admitted: number
    selectedId: string | null
    nodes: GraphNode[]
    /** 0 to 1 per node, so an arrival fades up instead of popping in. */
    age: Map<string, number>
    /** False until the camera has been placed once. */
    framed: boolean
  }>({
    layout: createLayout([], [], []),
    camera: { x: 0, y: 0, k: 1 },
    target: { x: 0, y: 0, k: 1 },
    hover: null,
    viewport: { width: 0, height: 0 },
    admitted: 0,
    selectedId: null,
    nodes: [],
    age: new Map(),
    framed: false,
  })

  live.current.selectedId = selectedId
  live.current.nodes = nodes

  // Admit opinions one at a time. Each arrival rebuilds the edge set, which is what
  // makes an incumbent edge disappear when a closer opinion turns up.
  useEffect(() => {
    const st = live.current
    while (st.admitted < admitted && st.admitted < nodes.length) {
      const next = nodes[st.admitted]
      const vectors = nodes.slice(0, st.admitted + 1).map((n) => n.embedding)
      addNode(st.layout, next.batchId, vectors, radiusForOps(next.ops))
      st.age.set(next.batchId, 0)
      st.admitted += 1
    }
  }, [admitted, nodes])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const st = live.current
    const reduceMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let dpr = Math.min(window.devicePixelRatio || 1, 2)

    function resize() {
      const rect = canvas!.getBoundingClientRect()
      st.viewport = { width: rect.width, height: rect.height }
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas!.width = Math.max(1, Math.round(rect.width * dpr))
      canvas!.height = Math.max(1, Math.round(rect.height * dpr))
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const nodeAt = (screenX: number, screenY: number) => {
      const world = toWorld(st.camera, screenX, screenY)
      // Back to front, so the node drawn on top is the one that answers a click.
      for (let i = st.layout.nodes.length - 1; i >= 0; i--) {
        const n = st.layout.nodes[i]
        if (Math.abs(n.x - world.x) <= n.r + 4 && Math.abs(n.y - world.y) <= n.r + 4) {
          return n
        }
      }
      return null
    }

    const localPoint = (e: PointerEvent) => {
      const rect = canvas!.getBoundingClientRect()
      return [e.clientX - rect.left, e.clientY - rect.top] as const
    }

    const onPointerMove = (e: PointerEvent) => {
      const [x, y] = localPoint(e)
      const hit = nodeAt(x, y)
      st.hover = hit?.id ?? null
      canvas!.style.cursor = hit ? 'pointer' : 'default'
    }

    const onPointerDown = (e: PointerEvent) => {
      const [x, y] = localPoint(e)
      const hit = nodeAt(x, y)
      if (!hit) {
        onSelect(null)
        return
      }
      const match = st.nodes.find((n) => n.batchId === hit.id)
      onSelect(match ?? null)
    }

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerdown', onPointerDown)

    let raf = 0
    let last = performance.now()

    function frame(now: number) {
      const dt = (now - last) / 1000
      last = now

      // Two steps a frame settles the cloud quickly enough to watch without the
      // arrival looking like it snaps into place.
      step(st.layout)
      step(st.layout)

      for (const [id, value] of st.age) {
        if (value < 1) st.age.set(id, Math.min(1, value + (reduceMotion ? 1 : dt * 2.2)))
      }

      const selected = st.selectedId
        ? st.layout.nodes.find((n) => n.id === st.selectedId)
        : null

      if (selected) {
        // A dive holds its subject still, or the pipeline's anchor would drift while
        // the reader is looking at it.
        for (const n of st.layout.nodes) n.pinned = n.id === selected.id
        // Sit the subject in the left third: the pipeline unrolls to its right.
        st.target = focusOn(
          selected,
          { x: st.viewport.width * 0.26, y: st.viewport.height * 0.5 },
          2.35,
        )
      } else {
        for (const n of st.layout.nodes) n.pinned = false
        st.target = frameBox(bounds(st.layout.nodes), st.viewport)
      }

      // The camera is placed outright the first time there is something to place it
      // around. Damping from an unset pose would fly the graph in from the top left
      // corner on load, which reads as the page being broken rather than as a move.
      if (!st.framed && st.layout.nodes.length > 0 && st.viewport.width > 0) {
        st.camera = st.target
        st.framed = true
      } else {
        st.camera = reduceMotion ? st.target : stepCamera(st.camera, st.target, dt)
      }

      const { width: W, height: H } = st.viewport
      ctx!.clearRect(0, 0, W, H)
      ctx!.fillStyle = BACKGROUND
      ctx!.fillRect(0, 0, W, H)

      // A dot field that fades toward the edges. It gives the pan something to move
      // against, so the camera reads as travelling rather than the graph sliding.
      const gap = 32
      const cx = W / 2
      const cy = H / 2
      const maxD = Math.hypot(W, H) / 2 || 1
      for (let gx = (W % gap) / 2; gx < W; gx += gap) {
        for (let gy = (H % gap) / 2; gy < H; gy += gap) {
          const alpha = 0.075 * (1 - Math.hypot(gx - cx, gy - cy) / maxD)
          if (alpha <= 0.004) continue
          ctx!.fillStyle = `rgba(233,238,247,${alpha.toFixed(3)})`
          ctx!.fillRect(gx, gy, 1.4, 1.4)
        }
      }

      ctx!.save()
      ctx!.translate(st.camera.x, st.camera.y)
      ctx!.scale(st.camera.k, st.camera.k)

      const dimmed = selected ? 0.16 : 1

      for (const e of st.layout.edges) {
        const a = st.layout.nodes[e.source]
        const b = st.layout.nodes[e.target]
        if (!a || !b) continue
        const touchesSubject = selected && (a.id === selected.id || b.id === selected.id)
        const settle = Math.min(st.age.get(a.id) ?? 1, st.age.get(b.id) ?? 1)
        const alpha = e.strength * 0.8 * settle * (touchesSubject ? 1 : dimmed)
        if (alpha <= 0.004) continue
        ctx!.strokeStyle = touchesSubject ? '#e9eef7' : EDGE
        ctx!.globalAlpha = alpha
        ctx!.lineWidth = (touchesSubject ? 2 : 1.5) / st.camera.k
        ctx!.beginPath()
        ctx!.moveTo(a.x, a.y)
        ctx!.lineTo(b.x, b.y)
        ctx!.stroke()
      }
      ctx!.globalAlpha = 1

      for (const n of st.layout.nodes) {
        const record = st.nodes.find((x) => x.batchId === n.id)
        if (!record) continue

        const isSubject = selected?.id === n.id
        const isHover = st.hover === n.id
        const age = st.age.get(n.id) ?? 1
        // Arrivals scale from 0.92, never from nothing: a specimen that grows out of a
        // point reads as an effect, one that grows from nearly full size reads as landing.
        const scale = (0.92 + age * 0.08) * (isHover && !selected ? 1.06 : 1)
        const r = n.r * scale
        const size = r * 2

        ctx!.globalAlpha = age * (isSubject || !selected ? 1 : dimmed)

        const plate = specimenCanvas(record.params, 128)
        ctx!.drawImage(plate, n.x - r, n.y - r, size, size)

        ctx!.strokeStyle = isSubject
          ? '#e9eef7'
          : isHover
            ? 'rgba(233,238,247,0.5)'
            : 'rgba(233,238,247,0.16)'
        ctx!.lineWidth = (isSubject ? 1.75 : 1) / st.camera.k
        ctx!.strokeRect(n.x - r, n.y - r, size, size)

        if (isSubject) {
          // One offset rule, no glow. Depth here is a second line, not a halo.
          const pad = 7 / st.camera.k
          ctx!.strokeStyle = 'rgba(233,238,247,0.35)'
          ctx!.lineWidth = 1 / st.camera.k
          ctx!.strokeRect(n.x - r - pad, n.y - r - pad, size + pad * 2, size + pad * 2)
        }

        if (isHover || isSubject) {
          ctx!.fillStyle = LABEL
          ctx!.font = `${10.5 / st.camera.k}px ui-monospace, "SF Mono", monospace`
          ctx!.textAlign = 'center'
          ctx!.textBaseline = 'top'
          ctx!.fillText(record.batchId, n.x, n.y + r + 7 / st.camera.k)
        }
        ctx!.globalAlpha = 1
      }

      ctx!.restore()
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerdown', onPointerDown)
    }
  }, [onSelect])

  return (
    <canvas
      ref={canvasRef}
      className="graph-canvas"
      role="img"
      aria-label="Opinion graph. Each node is one analysed opinion, placed by the distance between its embedding and its neighbours. A text list of every opinion follows."
    />
  )
}
