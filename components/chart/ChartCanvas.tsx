'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { ChartNode } from '@/app/api/graph/route'
import { labelFor } from '@/lib/graph/clusters'
import { onOwnScale, onScale, swarm } from '@/lib/graph/arrange'
import { createLayout, motion, separate, settle, step, type Layout } from '@/lib/graph/layout'
import { PLATE, blitFace, strikeFace } from './paintFace'

/**
 * The chart.
 *
 * Every opinion the factory has finished, placed by what it means. A node's position is not
 * decoration: the springs rest at the cosine distance between two embeddings, so two faces
 * sit close because the model put their sentences close. Nothing is bucketed by hand.
 *
 * The picture is settled before it is shown, and then it holds still. Nothing on this screen
 * moves unless somebody moves it. A chart that keeps simulating under a reader is not alive,
 * it is unable to sit still, and the run it is showing already happened.
 *
 * There are four ways to lay it out. By meaning is the chart's own answer and it is the one
 * it opens on. The other three are lines: how the opinion feels, how sure it sounds, when it
 * was put through, each read off a number the run measured. Changing between them walks
 * every face to its new place, because a face that teleports is a new face and a face that
 * walks is the same one seen a different way.
 *
 * The gestures are the ones people already have from Obsidian and every map: drag the
 * ground to move, wheel to zoom at the pointer, drag a face to pull it out and read around
 * it, hover to light up what it is joined to, click to open it.
 */

export type Arrangement = 'meaning' | 'feeling' | 'certainty' | 'time'

/** The two ends of each line, said the way somebody would say them out loud. */
export const ENDS: Record<Arrangement, [string, string] | null> = {
  meaning: null,
  feeling: ['AGAINST IT', 'FOR IT'],
  certainty: ['HEDGING', 'CERTAIN'],
  time: ['FIRST', 'LATEST'],
}

type Props = {
  nodes: ChartNode[]
  selectedId: string | null
  onSelect: (node: ChartNode | null) => void
  arrangement: Arrangement
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 3

/** How long a face takes to walk to its place in a new arrangement. */
const SHIFT_MS = 720

/** Below this nothing is moving by a visible amount, so the springs stop. */
const STILL = 0.01

/** How far a dragged face closes on the pointer each frame. Lag is what makes it smooth. */
const FOLLOW = 0.24

/** How wide the line arrangements are, in world units. */
const LINE_WIDTH = 1150

/** Clear space between two faces, in world units. Wide enough to read one tile at a time. */
const FACE_GAP = 24

/**
 * Where a clump's title fades. Full at the opening view, gone by the time somebody has
 * zoomed in far enough to be reading one face, because at that point the title is naming
 * something they can already see.
 */
const LABEL_FULL = 1.15
const LABEL_GONE = 1.8

/** Half the width of a face in world units, from how much work the run did. */
function halfWidthOf(node: ChartNode): number {
  return 22 + Math.min(16, Math.log10(Math.max(10, node.ops)) * 3.2)
}

/** The box every node sits inside, its own half width included. */
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

type Title = { group: number; text: string; alpha: number }
type Spot = { x: number; y: number }
type Shift = { from: Spot[]; to: Spot[]; start: number }

/**
 * Where every face goes in one arrangement.
 *
 * Meaning is not computed here. It is the arrangement the springs already settled into, kept
 * from the moment the chart was built, because a clump's home is one point and every member
 * of that clump shares it: walking them all to the home would stack a clump into a single
 * tile. `rest` is where they actually came to rest around it.
 */
function spotsFor(
  arrangement: Arrangement,
  nodes: ChartNode[],
  layout: Layout,
  rest: Spot[],
): Spot[] {
  if (arrangement === 'meaning') return rest

  const radii = layout.nodes.map((n) => n.r)
  const values =
    arrangement === 'feeling'
      ? nodes.map((n) => onScale(n.sort.feeling, -1, 1))
      : arrangement === 'certainty'
        ? nodes.map((n) => onScale(n.sort.certainty, 0, 1))
        : onOwnScale(nodes.map((n) => n.sort.time))

  return swarm(values, radii, LINE_WIDTH, FACE_GAP)
}

/** Slow at the end, so a face arrives rather than stopping. */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export function ChartCanvas({ nodes, selectedId, onSelect, arrangement }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Everything the animation loop touches lives in refs. State here would re-render the
  // whole screen sixty times a second to move some dots.
  const layoutRef = useRef<Layout | null>(null)
  const platesRef = useRef<Map<string, HTMLCanvasElement>>(new Map())
  const titlesRef = useRef<Title[]>([])
  const camRef = useRef({ x: 0, y: 0, zoom: 1 })
  const hoverRef = useRef<string | null>(null)
  const dragRef = useRef<{ kind: 'ground' | 'node'; id?: string; x: number; y: number } | null>(null)
  const movedRef = useRef(false)
  const framedRef = useRef(false)
  const restlessRef = useRef(false)
  const shiftRef = useRef<Shift | null>(null)
  const restRef = useRef<Spot[]>([])
  const aimRef = useRef<Spot | null>(null)
  const arrangementRef = useRef<Arrangement>(arrangement)
  const selectedRef = useRef<string | null>(selectedId)

  selectedRef.current = selectedId

  useEffect(() => {
    if (nodes.length === 0) return
    const layout = createLayout(
      nodes.map((n) => n.id),
      nodes.map((n) => n.embedding),
      nodes.map(halfWidthOf),
      { collidePad: FACE_GAP },
    )
    // Settled before the first paint, not settling in front of the reader. A graph that
    // arranges itself on arrival reads as a glitch, and the runs it shows already happened.
    settle(layout)
    layoutRef.current = layout
    // The settled arrangement, kept so that coming back to it is a walk home and not a
    // fresh simulation in front of the reader.
    restRef.current = layout.nodes.map((n) => ({ x: n.x, y: n.y }))

    const plates = new Map<string, HTMLCanvasElement>()
    for (const node of nodes) plates.set(node.id, strikeFace(node.face, '#070708'))
    platesRef.current = plates

    // One title per clump, named after the word its opinions share. A clump of one gets
    // nothing: a title over a single tile is a label, and the tile is already the label.
    const byGroup = new Map<number, string[]>()
    layout.nodes.forEach((n, i) => {
      const list = byGroup.get(n.group)
      const opinion = nodes[i]?.opinion ?? ''
      if (list) list.push(opinion)
      else byGroup.set(n.group, [opinion])
    })
    titlesRef.current = [...byGroup.entries()]
      .map(([group, texts]) => ({ group, text: labelFor(texts), alpha: 0 }))
      .filter((title) => title.text !== '')

    // Framing waits for the first frame that has a real canvas to frame into. Measuring
    // here would read a canvas the browser has not laid out yet, and the graph would open
    // at whatever zoom a zero-width viewport implies.
    framedRef.current = false
    shiftRef.current = null
    restlessRef.current = false
  }, [nodes])

  // Walk every face to its place in the arrangement that was just chosen.
  useEffect(() => {
    const layout = layoutRef.current
    if (!layout || nodes.length === 0) return
    arrangementRef.current = arrangement

    const to = spotsFor(arrangement, nodes, layout, restRef.current)
    shiftRef.current = {
      from: layout.nodes.map((n) => ({ x: n.x, y: n.y })),
      to,
      start: performance.now(),
    }
    // Nothing simulates during or after a walk. On a line the position IS the reading, so a
    // spring nudging a face off its number would be the chart quietly lying.
    restlessRef.current = false
    for (const n of layout.nodes) {
      n.vx = 0
      n.vy = 0
      n.pinned = arrangement !== 'meaning'
    }
    framedRef.current = false
  }, [arrangement, nodes])

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
      if (Math.abs(worldX - n.x) <= n.r && Math.abs(worldY - n.y) <= n.r) return n.id
    }
    return null
  }, [])

  // The loop. One rAF for the whole screen, stopped on unmount. It paints; it does not
  // simulate. Hovering, zooming, panning and the titles fading all need repainting and none
  // of them move a node.
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

      // A walk to a new arrangement. Nothing else moves while one is running.
      const shift = shiftRef.current
      if (shift) {
        const t = Math.min(1, (performance.now() - shift.start) / SHIFT_MS)
        const eased = easeOut(t)
        layout.nodes.forEach((n, i) => {
          const from = shift.from[i]
          const to = shift.to[i]
          if (!from || !to) return
          n.x = from.x + (to.x - from.x) * eased
          n.y = from.y + (to.y - from.y) * eased
        })
        if (t >= 1) {
          shiftRef.current = null
          // Framed once the walk is over. Measured halfway through, the box is the shape
          // the faces were passing through, which is nobody's arrangement.
          framedRef.current = false
        }
      }

      // A dragged face closes on the pointer rather than snapping to it. The gap that opens
      // when the hand moves fast is the whole feel of the thing: it reads as weight, and it
      // takes the twitch out of a pointer that never reports a straight line.
      const aim = aimRef.current
      const drag = dragRef.current
      if (aim && drag?.id && !shift) {
        const node = layout.nodes.find((n) => n.id === drag.id)
        if (node) {
          node.x += (aim.x - node.x) * FOLLOW
          node.y += (aim.y - node.y) * FOLLOW
          node.vx = 0
          node.vy = 0
        }
      }

      // The springs, while anything is still moving. Only by meaning, and only after a
      // face has been picked up: on a line a face's place is its reading, and at rest the
      // picture has already settled and has nothing left to say.
      if (restlessRef.current && !shift && arrangementRef.current === 'meaning') {
        step(layout)
        step(layout)
        step(layout)
        step(layout)
        if (!dragRef.current && motion(layout) < STILL) restlessRef.current = false
      }

      // Frame the settled cloud once, on the first frame with a canvas worth measuring.
      // The springs have no idea where the middle of a screen is, so a graph left at the
      // origin opens with its population shoved into one corner. Never zoomed past life
      // size: the opening view is the whole picture, and going closer is a decision.
      if (!framedRef.current && !shift && width > 0 && height > 0) {
        const box = boundsOf(layout)
        if (box) {
          framedRef.current = true
          const pad = 90
          camRef.current = {
            x: (box.minX + box.maxX) / 2,
            y: (box.minY + box.maxY) / 2,
            zoom: Math.min(
              1,
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

      // A line inside a clump says these two are about the same thing, and is worth seeing.
      // A line between two clumps says one opinion's nearest neighbour happens to live
      // somewhere else, which is true and is almost never what somebody came to find out.
      // Drawn, it is a long diagonal across the whole canvas, and thirty of them is a web
      // laid over the picture that hides the picture. So it only appears when the face at
      // one end is being looked at, which is the moment the question is actually asked.
      // The line itself. Without it a crowded reading is a pile of tiles; with it the pile
      // is a stack on an axis, which is what it actually is.
      if (arrangementRef.current !== 'meaning') {
        ctx.strokeStyle = 'rgba(92,90,88,0.4)'
        ctx.lineWidth = 1 / cam.zoom
        ctx.beginPath()
        ctx.moveTo(-LINE_WIDTH / 2 - 60, 0)
        ctx.lineTo(LINE_WIDTH / 2 + 60, 0)
        ctx.stroke()
      }

      for (const edge of layout.edges) {
        const a = layout.nodes[edge.source]
        const b = layout.nodes[edge.target]
        const lit = focus === a.id || focus === b.id
        // On a line, a face's place is its reading, so an edge is a diagonal drawn across
        // the whole screen between two faces that are not near each other any more. It only
        // appears under the face being looked at, which is where the question is asked.
        if (arrangementRef.current !== 'meaning' && !lit) continue
        if (a.group !== b.group && !lit) continue
        ctx.strokeStyle = lit
          ? 'rgba(216,85,42,0.5)'
          : `rgba(154,151,147,${0.08 + edge.strength * 0.18})`
        ctx.lineWidth = (lit ? 1.4 : 1) / cam.zoom
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }

      for (const n of layout.nodes) {
        const plate = platesRef.current.get(n.id)
        if (!plate) continue

        const dim = focus !== null && focus !== n.id && !near.has(n.id)
        ctx.globalAlpha = dim ? 0.32 : 1

        // The face is blitted at a whole multiple of its plate, so the dither never blurs.
        // Zoom sets which multiple, and the world transform is undone for the blit itself.
        // Floored, never rounded. Rounding up draws a face wider than the space the
        // layout kept for it, and every face then eats its neighbour's corner.
        const scale = Math.max(1, Math.floor((n.r * 2 * cam.zoom) / PLATE))

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
            Math.round(sx - box / 2) - 3.5,
            Math.round(sy - box / 2) - 3.5,
            box + 7,
            box + 7,
          )
        }
        ctx.restore()
      }

      ctx.globalAlpha = 1
      ctx.restore()

      if (arrangementRef.current === 'meaning') {
        drawTitles(ctx, layout, titlesRef.current, cam, width, height, focus !== null)
      } else {
        // Sat on the line itself, not in the middle of the window: a lopsided swarm moves
        // the line, and an end label floating away from the line it names is a caption for
        // nothing.
        drawEnds(ctx, ENDS[arrangementRef.current], width, height / 2 - cam.y * cam.zoom)
      }
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
    aimRef.current = null
    if (id) {
      const node = layoutRef.current?.nodes.find((n) => n.id === id)
      // Pinned so the springs move its neighbours around it rather than moving it. The
      // grip on a face is the hand's, not the simulation's.
      if (node) {
        node.pinned = true
        // The face is picked up where it was grabbed, so it does not jump under the
        // pointer on the first move.
        aimRef.current = { x: node.x, y: node.y }
      }
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
    } else if (aimRef.current) {
      // The pointer moves the target, not the face. The face closes on it in the draw
      // loop, which is what puts the weight in it and keeps the neighbours following.
      aimRef.current.x += dx / camRef.current.zoom
      aimRef.current.y += dy / camRef.current.zoom
      restlessRef.current = true
    }
    drag.x = e.clientX
    drag.y = e.clientY
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return

    aimRef.current = null
    if (drag.id) {
      const layout = layoutRef.current
      const node = layout?.nodes.find((n) => n.id === drag.id)
      // A dragged face stays where it was put. Somebody moved it there on purpose, and a
      // picture that springs back the moment you let go cannot be organised. On a line
      // every face stays pinned anyway, because its place there is its reading.
      if (node) node.pinned = movedRef.current || arrangementRef.current !== 'meaning'
      clearTheWay(layout)
      // A face moved by hand becomes part of the arrangement it was moved in, so going off
      // to a line and coming back brings the reader's own tidying back with them.
      if (layout && arrangementRef.current === 'meaning' && movedRef.current) {
        restRef.current = layout.nodes.map((n) => ({ x: n.x, y: n.y }))
      }
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

/**
 * The two ends of a line arrangement, named.
 *
 * Pinned to the sides of the screen rather than to the ends of the line itself, so they
 * stay readable however far the reader has panned or zoomed. They are what the arrangement
 * means, and an arrangement whose meaning scrolls off the edge is a scatter of tiles.
 */
function drawEnds(
  ctx: CanvasRenderingContext2D,
  ends: [string, string] | null,
  width: number,
  lineY: number,
): void {
  if (!ends) return
  ctx.save()
  ctx.font = '500 10px ui-monospace, SFMono-Regular, Menlo, monospace'
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.26em'
  ctx.fillStyle = 'rgba(154,151,147,0.5)'
  ctx.textBaseline = 'middle'

  ctx.textAlign = 'left'
  ctx.fillText(ends[0], 24, lineY)
  ctx.textAlign = 'right'
  ctx.fillText(ends[1], width - 24, lineY)
  ctx.restore()
}

/**
 * Nudge anything the dragged face has been put on top of out from under it.
 *
 * Position corrections only, run to convergence, which for sixteen plates is a handful of
 * passes over a few hundred pairs. No springs, so nothing is pulled anywhere and nothing
 * carries on moving after this returns.
 */
function clearTheWay(layout: Layout | null): void {
  if (!layout) return
  for (let i = 0; i < 6; i++) separate(layout.nodes, layout.options.collidePad)
}

/**
 * The word over each clump.
 *
 * Drawn in screen space, not world space, so a title is the same size however far in the
 * reader has zoomed. It sits above its clump and holds its own alpha, eased toward where it
 * should be rather than snapped, because a title that pops in and out on the zoom is the
 * kind of movement the rest of this screen was just made to stop doing.
 */
function drawTitles(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  titles: Title[],
  cam: { x: number; y: number; zoom: number },
  width: number,
  height: number,
  focused: boolean,
): void {
  if (titles.length === 0) return

  const zoomed =
    cam.zoom <= LABEL_FULL
      ? 1
      : cam.zoom >= LABEL_GONE
        ? 0
        : 1 - (cam.zoom - LABEL_FULL) / (LABEL_GONE - LABEL_FULL)
  // A face being read owns the screen, so the titles step back rather than compete with it.
  const target = zoomed * (focused ? 0.18 : 1)

  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = '500 10px ui-monospace, SFMono-Regular, Menlo, monospace'
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.26em'

  for (const title of titles) {
    title.alpha += (target - title.alpha) * 0.12
    if (title.alpha < 0.02) continue

    let sumX = 0
    let top = Infinity
    let members = 0
    for (const n of layout.nodes) {
      if (n.group !== title.group) continue
      sumX += n.x
      top = Math.min(top, n.y - n.r)
      members++
    }
    if (members === 0) continue

    const sx = width / 2 + (sumX / members - cam.x) * cam.zoom
    const sy = height / 2 + (top - cam.y) * cam.zoom - 22
    if (sx < -200 || sx > width + 200 || sy < -60 || sy > height + 60) continue

    ctx.fillStyle = `rgba(154,151,147,${title.alpha * 0.72})`
    ctx.fillText(title.text, sx, sy)
  }

  ctx.restore()
}
