/**
 * The floor plan of the opinion graph.
 *
 * One rule governs everything here: a spring's rest length is the cosine distance between
 * the two opinions it joins. Nothing else places a node. There is no cluster id, no stance
 * bucket, no hand-tuned group centre. The clumps that appear are the shape of the embedding
 * space with the springs relaxed, so a clump is a claim about the text and can be checked
 * by reading the two opinions sitting on top of each other.
 *
 * Deterministic by construction: the same opinions in the same order settle to the same
 * picture, because the only randomness is a seeded scatter of the starting positions.
 */

import { mulberry32 } from '../foundry/noise'
import { buildEdges, type Edge } from './similarity'

export type LayoutNode = {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  /** Radius in world units. Set from the node's own weight, never from its stance. */
  r: number
  /** True while the node is pinned, which is how a dive holds its subject still. */
  pinned: boolean
}

export type LayoutOptions = {
  /** Neighbours each node reaches for. Three keeps the picture readable at demo scale. */
  k: number
  /** World units per unit of cosine distance. Sets how far apart disagreement pushes. */
  spread: number
  /** Shortest a spring may rest, so identical opinions do not sit exactly on each other. */
  minRest: number
  repulsion: number
  springStrength: number
  centreStrength: number
  friction: number
  /** Clear space kept between two node edges, in world units. */
  collidePad: number
  seed: number
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  k: 3,
  spread: 420,
  minRest: 96,
  repulsion: 2400,
  springStrength: 0.045,
  centreStrength: 0.0016,
  friction: 0.86,
  collidePad: 9,
  seed: 0xd07a,
}

export type Layout = {
  nodes: LayoutNode[]
  edges: Edge[]
  options: LayoutOptions
}

/**
 * Place a fresh set of opinions.
 *
 * Nodes start on a seeded ring rather than at the origin: from a single point every
 * repulsion vector is degenerate and the first frames explode in an arbitrary direction,
 * which reads as a glitch rather than a settling.
 */
export function createLayout(
  ids: string[],
  vectors: number[][],
  radii: number[],
  options: Partial<LayoutOptions> = {},
): Layout {
  const opts = { ...DEFAULT_LAYOUT, ...options }
  const rand = mulberry32(opts.seed)

  const nodes: LayoutNode[] = ids.map((id, i) => {
    const angle = rand() * Math.PI * 2
    const radius = 90 + rand() * 140
    return {
      id,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      r: radii[i] ?? 22,
      pinned: false,
    }
  })

  return { nodes, edges: buildEdges(vectors, opts.k, 0.6), options: opts }
}

/**
 * Rest length for an edge: the cosine distance, scaled into world units.
 *
 * `minRest` is a floor, not a fudge. Two near-identical opinions genuinely have a distance
 * near zero, and drawing them at zero separation would hide one behind the other, which
 * would misreport "we found a duplicate" as "we found one opinion".
 */
export function restLength(distance: number, opts: LayoutOptions): number {
  return opts.minRest + distance * opts.spread
}

/**
 * Advance the simulation one fixed step.
 *
 * Fixed rather than frame-timed on purpose: a variable dt makes the settled picture depend
 * on the machine's frame rate, so the same graph would look different on a slow laptop and
 * a demo screen. The caller runs however many steps it wants per frame.
 */
export function step(layout: Layout): Layout {
  const { nodes, edges, options } = layout

  for (const n of nodes) {
    if (n.pinned) continue

    let fx = 0
    let fy = 0

    // Every pair pushes apart. O(n squared) is honest at this scale and costs nothing
    // for the low hundreds of opinions a topic actually holds.
    for (const other of nodes) {
      if (other === n) continue
      const dx = n.x - other.x
      const dy = n.y - other.y
      const distSq = dx * dx + dy * dy || 0.01
      const dist = Math.sqrt(distSq)
      const force = options.repulsion / distSq
      fx += (dx / dist) * force
      fy += (dy / dist) * force
    }

    // A weak pull to the origin, so a node with no close neighbour drifts back into
    // frame instead of being flung off the canvas by repulsion alone.
    fx -= n.x * options.centreStrength * 100
    fy -= n.y * options.centreStrength * 100

    n.vx = (n.vx + fx * 0.0016) * options.friction
    n.vy = (n.vy + fy * 0.0016) * options.friction
  }

  // Springs act on both ends, so they run after the per-node pass rather than inside it.
  for (const e of edges) {
    const a = nodes[e.source]
    const b = nodes[e.target]
    if (!a || !b) continue

    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
    const rest = restLength(e.distance, options)
    const displacement = dist - rest
    const force = displacement * options.springStrength
    const ux = dx / dist
    const uy = dy / dist

    if (!a.pinned) {
      a.vx += ux * force
      a.vy += uy * force
    }
    if (!b.pinned) {
      b.vx -= ux * force
      b.vy -= uy * force
    }
  }

  for (const n of nodes) {
    if (n.pinned) continue
    n.x += n.vx
    n.y += n.vy
  }

  separate(nodes, options.collidePad)

  return layout
}

/**
 * Push overlapping nodes apart, after the forces have moved them.
 *
 * Specimens are the reading, so one covering another destroys the only thing on screen
 * worth looking at, and two near-identical opinions are exactly the case that drives
 * them into the same spot. Repulsion alone cannot fix it: a spring whose rest length is
 * a near-zero cosine distance will always win at close range. So overlap is resolved as
 * a position correction rather than another force, which cannot be out-pulled.
 *
 * Nodes are square, so the clearance is measured on the square, not on a circle through
 * its corners: two plates touching corner to corner do not hide anything.
 */
export function separate(nodes: LayoutNode[], pad: number): void {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const need = a.r + b.r + pad

      // Overlap only if BOTH axes overlap, which is what square plates do.
      const overlapX = need - Math.abs(dx)
      const overlapY = need - Math.abs(dy)
      if (overlapX <= 0 || overlapY <= 0) continue

      // Resolve along the shallower axis: the shortest move that clears the plates.
      if (overlapX < overlapY) {
        const push = (overlapX / 2) * (dx < 0 ? -1 : 1)
        if (!a.pinned) a.x -= push
        if (!b.pinned) b.x += push
      } else {
        const push = (overlapY / 2) * (dy < 0 ? -1 : 1)
        if (!a.pinned) a.y -= push
        if (!b.pinned) b.y += push
      }
    }
  }
}

/**
 * Add one opinion to a settled graph and rebuild the edge set.
 *
 * The rebuild is the point. A newcomer that is closer to some node than that node's
 * current third neighbour takes the slot, and the edge it replaces disappears. So the
 * graph re-sorts itself as it grows rather than only accumulating, and an edge vanishing
 * is a real statement: something better arrived.
 */
export function addNode(
  layout: Layout,
  id: string,
  vectors: number[][],
  radius: number,
): Layout {
  const rand = mulberry32(layout.options.seed + layout.nodes.length)
  const angle = rand() * Math.PI * 2
  // Newcomers enter from outside the settled cloud and are pulled in by their own
  // springs, which makes the arrival read as joining rather than materialising.
  const radial = 380 + rand() * 120

  layout.nodes.push({
    id,
    x: Math.cos(angle) * radial,
    y: Math.sin(angle) * radial,
    vx: 0,
    vy: 0,
    r: radius,
    pinned: false,
  })
  layout.edges = buildEdges(vectors, layout.options.k, 0.6)
  return layout
}

/** Bounding box of the settled cloud, for framing the camera. */
export function bounds(nodes: LayoutNode[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.r)
    minY = Math.min(minY, n.y - n.r)
    maxX = Math.max(maxX, n.x + n.r)
    maxY = Math.max(maxY, n.y + n.r)
  }
  return { minX, minY, maxX, maxY }
}
