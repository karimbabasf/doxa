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
import { groupsOf } from './clusters'
import { packClumps, roomFor } from './pack'
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
  /**
   * Which clump this node came out in. Read off the same nearest neighbour edges the
   * springs use, never assigned by hand.
   */
  group: number
  /** Where this node's clump lives on the canvas. Every member shares one home. */
  homeX: number
  homeY: number
}

export type LayoutOptions = {
  /** Neighbours each node reaches for. Three keeps the picture readable at demo scale. */
  k: number
  /**
   * World units per unit of cosine distance. Sets how far apart disagreement pushes, and it
   * is the whole reason the picture has shape: a subject's own opinions sit a tenth of a
   * unit apart and two subjects sit most of a unit apart, so a wide spread turns that
   * difference into clumps with visible lanes between them and a narrow one turns it into
   * an even field of tiles. Nothing separates clumps except this. A force that pushed
   * groups apart as bodies was tried and taken out: the nearest neighbour springs pull
   * across clumps too, so the two never agreed and the picture shook forever.
   */
  spread: number
  /**
   * Shortest a spring may rest, so identical opinions do not sit exactly on each other.
   * Low on purpose: the real floor is the geometry, applied in `step`, which never lets a
   * spring ask for closer than two plates can sit.
   */
  minRest: number
  repulsion: number
  springStrength: number
  /**
   * How hard a node is held near its clump's place on the canvas.
   *
   * This used to be a pull to the origin, which is what turned the picture into one pile:
   * every clump was being dragged into the same spot and only the springs stood against
   * it. Now the pull has somewhere sensible to pull to, so it holds the arrangement
   * together instead of collapsing it.
   */
  homeStrength: number
  friction: number
  /** Clear space kept between two node edges, in world units. */
  collidePad: number
  /** Clear space kept between one clump and the next, in world units. */
  groupGap: number
  seed: number
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  k: 3,
  spread: 500,
  minRest: 40,
  repulsion: 2400,
  springStrength: 0.045,
  homeStrength: 0.0016,
  friction: 0.86,
  collidePad: 9,
  groupGap: 100,
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
 * Two questions, answered two different ways. Which opinions belong together, and where an
 * opinion sits among the ones it belongs with, are questions about meaning: the nearest
 * neighbour edges answer both, and the springs relax them into a shape somebody can check
 * by reading the two sentences sitting next to each other. Where one clump sits relative to
 * another is a question about a screen, and it is answered by packing them, because a force
 * field asked that question produces a tall stripe with the clumps standing inside each
 * other.
 *
 * Nodes start scattered around their clump's place rather than exactly on it: from a single
 * point every repulsion vector is degenerate and the first steps fly off in an arbitrary
 * direction.
 */
export function createLayout(
  ids: string[],
  vectors: number[][],
  radii: number[],
  options: Partial<LayoutOptions> = {},
): Layout {
  const opts = { ...DEFAULT_LAYOUT, ...options }
  const rand = mulberry32(opts.seed)
  const edges = buildEdges(vectors, opts.k, 0.6)
  const groups = groupsOf(ids.length, edges)
  const homes = homesFor(groups, ids.map((_, i) => radii[i] ?? 22), opts)

  const nodes: LayoutNode[] = ids.map((id, i) => {
    const group = groups[i] ?? 0
    const home = homes.get(group) ?? { x: 0, y: 0 }
    const angle = rand() * Math.PI * 2
    const radius = 20 + rand() * 60
    return {
      id,
      x: home.x + Math.cos(angle) * radius,
      y: home.y + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      r: radii[i] ?? 22,
      pinned: false,
      group,
      homeX: home.x,
      homeY: home.y,
    }
  })

  return { nodes, edges, options: opts }
}

/** One place per clump, sized to what that clump holds. */
function homesFor(
  groups: number[],
  radii: number[],
  opts: LayoutOptions,
): Map<number, { x: number; y: number }> {
  const byGroup = new Map<number, number[]>()
  groups.forEach((group, i) => {
    const list = byGroup.get(group)
    if (list) list.push(radii[i])
    else byGroup.set(group, [radii[i]])
  })

  return packClumps(
    [...byGroup.entries()].map(([group, halfWidths]) => ({
      group,
      radius: roomFor(halfWidths.length, halfWidths, opts.collidePad),
    })),
    opts.groupGap,
  )
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

    // A weak pull toward where this node's clump lives. It keeps a node with no close
    // neighbour from being flung off the canvas by repulsion alone, and it is what holds
    // the clumps in the places they were packed into.
    fx -= (n.x - n.homeX) * options.homeStrength * 100
    fy -= (n.y - n.homeY) * options.homeStrength * 100

    n.vx = (n.vx + fx * 0.0016) * options.friction
    n.vy = (n.vy + fy * 0.0016) * options.friction
  }

  // Springs act on both ends, so they run after the per-node pass rather than inside it.
  for (const e of edges) {
    const a = nodes[e.source]
    const b = nodes[e.target]
    if (!a || !b) continue

    // Inside a clump only. A spring between clumps has nothing useful to say: the two
    // opinions are far apart in meaning, so its rest length is enormous, and it spends
    // every step trying to shove two clumps to opposite ends of the canvas against the
    // packing that put them where they are. The edge is still drawn, because it is still
    // true that these two are each other's nearest neighbours. It just does not get a
    // vote on where the clumps go.
    if (a.group !== b.group) continue

    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
    // The floor is the geometry, not the meaning.
    //
    // The separator clears squares, so two plates sitting corner to corner need root two
    // times the axis clearance between their centres. A spring resting closer than that
    // pulls a pair together every step and the separator shoves them apart every step, and
    // the picture shakes forever without ever settling. That was the shake: not a graph
    // still thinking, a graph in a standoff with itself.
    const clear = (a.r + b.r + options.collidePad) * Math.SQRT2
    const rest = Math.max(restLength(e.distance, options), clear)
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
      //
      // The velocity into the correction goes with it. A position correction that leaves
      // the speed behind is a wall that stores everything thrown at it: the forces push a
      // plate in, this pushes it back out, and next step the speed it kept pushes it in
      // again. Sixteen plates doing that is a picture that never stops trembling, which is
      // exactly what it looked like.
      if (overlapX < overlapY) {
        const push = (overlapX / 2) * (dx < 0 ? -1 : 1)
        if (!a.pinned) {
          a.x -= push
          a.vx = 0
        }
        if (!b.pinned) {
          b.x += push
          b.vx = 0
        }
      } else {
        const push = (overlapY / 2) * (dy < 0 ? -1 : 1)
        if (!a.pinned) {
          a.y -= push
          a.vy = 0
        }
        if (!b.pinned) {
          b.y += push
          b.vy = 0
        }
      }
    }
  }
}

/**
 * How much the picture is still moving, as the fastest node's speed in world units.
 *
 * The number the freeze reads. A chart that keeps simulating under somebody trying to read
 * it is not alive, it is unable to stop, so the loop watches this and puts the physics down
 * when it goes quiet.
 */
export function motion(layout: Layout): number {
  let most = 0
  for (const n of layout.nodes) {
    if (n.pinned) continue
    most = Math.max(most, Math.hypot(n.vx, n.vy))
  }
  return most
}

/**
 * Step until the picture stops moving, or until the step budget runs out.
 *
 * Returns how many steps it took, which is the only honest way to tell a graph that settled
 * from a graph that hit the ceiling still twitching.
 */
export function settle(layout: Layout, maxSteps = 2000, quiet = 0.008): number {
  for (let i = 1; i <= maxSteps; i++) {
    step(layout)
    if (motion(layout) < quiet) return i
  }
  return maxSteps
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
    group: 0,
    homeX: 0,
    homeY: 0,
  })
  layout.edges = buildEdges(vectors, layout.options.k, 0.6)
  // The newcomer can join two clumps into one, or split its own off, so the grouping and
  // the packing are both redone rather than extended. The springs then walk everything to
  // its new place, which is the arrival worth watching.
  const groups = groupsOf(layout.nodes.length, layout.edges)
  const homes = homesFor(groups, layout.nodes.map((n) => n.r), layout.options)
  layout.nodes.forEach((n, i) => {
    n.group = groups[i] ?? 0
    const home = homes.get(n.group) ?? { x: 0, y: 0 }
    n.homeX = home.x
    n.homeY = home.y
  })
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
