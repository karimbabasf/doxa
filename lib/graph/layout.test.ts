import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAYOUT,
  addNode,
  bounds,
  createLayout,
  motion,
  restLength,
  separate,
  settle as settleUntilStill,
  step,
} from './layout'

const rad = (deg: number) => (deg * Math.PI) / 180
const onCircle = (deg: number) => [Math.cos(rad(deg)), Math.sin(rad(deg))]

/** Three opinions: two near-identical, one far off. The shape every test below leans on. */
function trio() {
  const vectors = [onCircle(0), onCircle(8), onCircle(150)]
  const layout = createLayout(['a', 'b', 'c'], vectors, [22, 22, 22], { k: 1 })
  return { layout, vectors }
}

const distanceBetween = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y)

function settle(layout: ReturnType<typeof createLayout>, steps = 600) {
  for (let i = 0; i < steps; i++) step(layout)
  return layout
}

describe('restLength', () => {
  it('is the floor at zero distance, so identical opinions still separate', () => {
    expect(restLength(0, DEFAULT_LAYOUT)).toBe(DEFAULT_LAYOUT.minRest)
  })

  it('grows linearly with cosine distance', () => {
    const opts = { ...DEFAULT_LAYOUT, minRest: 100, spread: 1000 }
    expect(restLength(0.25, opts)).toBe(350)
    expect(restLength(0.5, opts)).toBe(600)
  })
})

describe('createLayout', () => {
  it('is deterministic: the same opinions place identically', () => {
    const a = trio().layout
    const b = trio().layout
    expect(a.nodes.map((n) => [n.x, n.y])).toEqual(b.nodes.map((n) => [n.x, n.y]))
  })

  it('never starts two nodes on the same point, which would degenerate repulsion', () => {
    const { nodes } = trio().layout
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        expect(distanceBetween(nodes[i], nodes[j])).toBeGreaterThan(0)
      }
    }
  })

  it('carries the radius it was given, so size never comes from stance', () => {
    const layout = createLayout(['a', 'b'], [onCircle(0), onCircle(90)], [14, 48])
    expect(layout.nodes.map((n) => n.r)).toEqual([14, 48])
  })
})

describe('step', () => {
  it('settles near-identical opinions closer than distant ones', () => {
    const { layout } = trio()
    settle(layout)
    const [a, b, c] = layout.nodes
    expect(distanceBetween(a, b)).toBeLessThan(distanceBetween(a, c))
  })

  it('settles a spring near its rest length', () => {
    const layout = createLayout(['a', 'b'], [onCircle(0), onCircle(40)], [22, 22], {
      k: 1,
    })
    settle(layout, 1200)
    const rest = restLength(layout.edges[0].distance, layout.options)
    const actual = distanceBetween(layout.nodes[0], layout.nodes[1])
    // Repulsion holds the pair slightly wide of rest. Within a quarter is the picture
    // reading correctly; an exact match would mean repulsion had stopped acting.
    expect(Math.abs(actual - rest) / rest).toBeLessThan(0.25)
  })

  it('holds a pinned node exactly still, which is what a dive relies on', () => {
    const { layout } = trio()
    layout.nodes[0].pinned = true
    const before = { x: layout.nodes[0].x, y: layout.nodes[0].y }
    settle(layout, 200)
    expect(layout.nodes[0].x).toBe(before.x)
    expect(layout.nodes[0].y).toBe(before.y)
  })

  it('comes to rest rather than drifting forever', () => {
    const { layout } = trio()
    settle(layout, 1500)
    for (const n of layout.nodes) {
      expect(Math.hypot(n.vx, n.vy)).toBeLessThan(1)
    }
  })

  it('keeps the settled cloud finite', () => {
    const { layout } = trio()
    settle(layout, 1500)
    for (const n of layout.nodes) {
      expect(Number.isFinite(n.x)).toBe(true)
      expect(Number.isFinite(n.y)).toBe(true)
    }
  })
})

describe('addNode', () => {
  it('enters the newcomer outside the settled cloud', () => {
    const { layout, vectors } = trio()
    settle(layout)
    const next = [...vectors, onCircle(4)]
    addNode(layout, 'd', next, 22)
    const entrant = layout.nodes[3]
    expect(Math.hypot(entrant.x, entrant.y)).toBeGreaterThan(300)
  })

  it('rebuilds the edge set, dropping an edge a closer arrival displaces', () => {
    const vectors = [onCircle(0), onCircle(120), onCircle(40)]
    const layout = createLayout(['a', 'b', 'c'], vectors, [22, 22, 22], { k: 1 })
    expect(layout.edges.some((e) => e.source === 0 && e.target === 2)).toBe(true)

    addNode(layout, 'd', [...vectors, onCircle(5)], 22)
    expect(layout.edges.some((e) => e.source === 0 && e.target === 3)).toBe(true)
    expect(layout.edges.some((e) => e.source === 0 && e.target === 2)).toBe(false)
  })

  it('pulls the newcomer in toward the opinion it agrees with', () => {
    const { layout, vectors } = trio()
    settle(layout)
    const next = [...vectors, onCircle(4)]
    addNode(layout, 'd', next, 22)
    const entryGap = distanceBetween(layout.nodes[3], layout.nodes[0])
    settle(layout, 900)
    expect(distanceBetween(layout.nodes[3], layout.nodes[0])).toBeLessThan(entryGap)
  })
})

describe('bounds', () => {
  it('is all zeros for an empty graph', () => {
    expect(bounds([])).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 })
  })

  it('includes each node radius, so framing never clips a specimen', () => {
    const box = bounds([
      { id: 'a', x: 0, y: 0, vx: 0, vy: 0, r: 10, pinned: false, group: 0, homeX: 0, homeY: 0 },
      { id: 'b', x: 100, y: 50, vx: 0, vy: 0, r: 20, pinned: false, group: 0, homeX: 0, homeY: 0 },
    ])
    expect(box).toEqual({ minX: -10, minY: -10, maxX: 120, maxY: 70 })
  })
})

describe('settle', () => {
  it('stops the picture rather than leaving it twitching', () => {
    const { layout } = trio()
    const steps = settleUntilStill(layout)
    expect(steps).toBeLessThan(2000)
    expect(motion(layout)).toBeLessThan(0.008)
  })

  it('holds still once it has settled, so a chart nobody touches does not shake', () => {
    const vectors = [onCircle(0), onCircle(4), onCircle(9), onCircle(140), onCircle(146)]
    const layout = createLayout(['a', 'b', 'c', 'd', 'e'], vectors, [48, 48, 48, 48, 48])
    settleUntilStill(layout)
    const before = layout.nodes.map((n) => ({ x: n.x, y: n.y }))
    for (let i = 0; i < 240; i++) step(layout)
    // Four more seconds of stepping moves the picture by less than a plate's border.
    // The chart stops stepping entirely at this point, so this is the margin, not the
    // motion anybody sees.
    layout.nodes.forEach((n, i) => {
      expect(Math.hypot(n.x - before[i].x, n.y - before[i].y)).toBeLessThan(3)
    })
  })

  it('never asks a spring to pull two plates closer than the separator will allow', () => {
    // Big plates and near-identical opinions: the pair the old standoff was made of.
    const layout = createLayout(['a', 'b'], [onCircle(0), onCircle(2)], [54, 54], { k: 1 })
    settleUntilStill(layout)
    const [a, b] = layout.nodes
    const need = a.r + b.r + layout.options.collidePad
    expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeGreaterThanOrEqual(
      need - 1,
    )
  })
})

describe('groups', () => {
  /** Two subjects, three opinions each, near-identical inside and far apart across. */
  function twoSubjects() {
    const vectors = [
      onCircle(0),
      onCircle(4),
      onCircle(9),
      onCircle(150),
      onCircle(155),
      onCircle(159),
    ]
    return createLayout(['a', 'b', 'c', 'd', 'e', 'f'], vectors, [22, 22, 22, 22, 22, 22])
  }

  it('puts the two subjects in two clumps', () => {
    const layout = twoSubjects()
    const groups = layout.nodes.map((n) => n.group)
    expect(new Set(groups).size).toBe(2)
    expect(groups[0]).toBe(groups[2])
    expect(groups[3]).toBe(groups[5])
    expect(groups[0]).not.toBe(groups[3])
  })

  it('settles with clear space between the clumps, which is the whole picture', () => {
    const layout = twoSubjects()
    settleUntilStill(layout)

    const within: number[] = []
    const between: number[] = []
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        const a = layout.nodes[i]
        const b = layout.nodes[j]
        ;(a.group === b.group ? within : between).push(distanceBetween(a, b))
      }
    }

    const worstWithin = Math.max(...within)
    const closestBetween = Math.min(...between)
    // Not on average: the widest pair inside a clump is still closer together than the
    // nearest pair across clumps. That is what makes a clump read as a clump.
    expect(closestBetween).toBeGreaterThan(worstWithin)
  })
})

describe('separate', () => {
  const node = (id: string, x: number, y: number, r = 20) => ({
    id,
    x,
    y,
    vx: 0,
    vy: 0,
    r,
    pinned: false,
    group: 0,
    homeX: 0,
    homeY: 0,
  })

  /** Square plates clear each other when EITHER axis is clear. */
  const clear = (a: { x: number; y: number; r: number }, b: { x: number; y: number; r: number }, pad: number) =>
    Math.abs(a.x - b.x) >= a.r + b.r + pad - 1e-9 ||
    Math.abs(a.y - b.y) >= a.r + b.r + pad - 1e-9

  it('pushes two stacked plates apart', () => {
    const nodes = [node('a', 0, 0), node('b', 3, 2)]
    separate(nodes, 9)
    expect(clear(nodes[0], nodes[1], 9)).toBe(true)
  })

  it('leaves plates that already clear each other exactly where they were', () => {
    const nodes = [node('a', 0, 0), node('b', 400, 0)]
    separate(nodes, 9)
    expect(nodes[0].x).toBe(0)
    expect(nodes[1].x).toBe(400)
  })

  it('never moves a pinned node, so a dive subject stays put', () => {
    const nodes = [node('a', 0, 0), node('b', 2, 1)]
    nodes[0].pinned = true
    separate(nodes, 9)
    expect(nodes[0].x).toBe(0)
    expect(nodes[0].y).toBe(0)
  })

  it('resolves along the shallower axis, the shortest move that clears', () => {
    // Nearly clear on x, deeply overlapped on y: it should move on x.
    const nodes = [node('a', 0, 0), node('b', 46, 1)]
    separate(nodes, 9)
    expect(Math.abs(nodes[0].y - nodes[1].y)).toBeCloseTo(1, 9)
    expect(clear(nodes[0], nodes[1], 9)).toBe(true)
  })
})

describe('the settled graph', () => {
  const rad2 = (deg: number) => (deg * Math.PI) / 180
  const circle = (deg: number) => [Math.cos(rad2(deg)), Math.sin(rad2(deg))]

  it('never leaves two specimens overlapping, whatever the opinions', () => {
    // Three identical opinions: the case that drives nodes into the same spot.
    const vectors = [circle(0), circle(0), circle(0), circle(90), circle(91)]
    const layout = createLayout(
      ['a', 'b', 'c', 'd', 'e'],
      vectors,
      [30, 30, 30, 30, 30],
    )
    for (let i = 0; i < 1200; i++) step(layout)

    const pad = layout.options.collidePad
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        const a = layout.nodes[i]
        const b = layout.nodes[j]
        const need = a.r + b.r + pad
        const clearOnX = Math.abs(a.x - b.x) >= need - 1e-6
        const clearOnY = Math.abs(a.y - b.y) >= need - 1e-6
        expect(clearOnX || clearOnY).toBe(true)
      }
    }
  })
})
