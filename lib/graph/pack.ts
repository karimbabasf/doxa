/**
 * Where each clump sits on the canvas.
 *
 * The springs decide where an opinion sits inside its clump, because that is a statement
 * about meaning and it can be checked. Where one clump sits relative to another is not: it
 * is a question about a screen, and letting a force field answer it produced a tall stripe
 * with three clumps standing inside each other. So the clumps are given places.
 *
 * Deterministic and non-overlapping by construction. Biggest first onto a golden angle
 * spiral, each one taking the first spot that clears everything already down, so the
 * arrangement is stable: the same clumps always land in the same places.
 */

export type Clump = {
  group: number
  /** How much room this clump's own contents need, in world units. */
  radius: number
}

export type Spot = { x: number; y: number }

/** Roughly 137.5 degrees. The angle sunflowers use, and it packs for the same reason. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5))

/** How far out each candidate step reaches. Small enough to find tight fits. */
const STEP = 26

/**
 * Place every clump so no two overlap, with `gap` of clear space between their edges.
 *
 * `wide` stretches the finished arrangement sideways. Screens are wider than they are tall
 * and a circular pack wastes both ends of one; stretching one axis after the packing is
 * done can only add distance between clumps, so it cannot undo the clearance.
 */
export function packClumps(clumps: Clump[], gap = 100, wide = 1.35): Map<number, Spot> {
  // Biggest first, ties broken on the group number so the same set always packs the same.
  const order = [...clumps].sort((a, b) => b.radius - a.radius || a.group - b.group)
  const placed: (Clump & Spot)[] = []
  const spots = new Map<number, Spot>()

  for (const clump of order) {
    let spot: Spot = { x: 0, y: 0 }

    if (placed.length > 0) {
      for (let t = 0; t < 4000; t++) {
        const reach = STEP * Math.sqrt(t)
        const angle = t * GOLDEN
        const candidate = { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach }
        const clears = placed.every(
          (other) =>
            Math.hypot(candidate.x - other.x, candidate.y - other.y) >=
            clump.radius + other.radius + gap,
        )
        if (clears) {
          spot = candidate
          break
        }
      }
    }

    placed.push({ ...clump, ...spot })
    spots.set(clump.group, spot)
  }

  // Centre the whole arrangement, then stretch it to the shape of a screen.
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of placed) {
    minX = Math.min(minX, p.x - p.radius)
    maxX = Math.max(maxX, p.x + p.radius)
    minY = Math.min(minY, p.y - p.radius)
    maxY = Math.max(maxY, p.y + p.radius)
  }
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2

  for (const [group, spot] of spots) {
    spots.set(group, { x: (spot.x - midX) * wide, y: spot.y - midY })
  }

  return spots
}

/**
 * How much room a clump of this many faces needs.
 *
 * Area first, then a margin: the faces inside are laid out by springs, and a circle sized
 * to the exact area they occupy leaves nothing for the shape they actually settle into.
 */
export function roomFor(count: number, halfWidths: number[], pad: number): number {
  const widest = Math.max(...halfWidths, 1)
  const cell = widest * 2 + pad
  return Math.sqrt((count * cell * cell) / Math.PI) * 1.1 + widest
}
