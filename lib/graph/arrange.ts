/**
 * The other ways to lay the chart out.
 *
 * By meaning is the chart's own answer and it is the one it opens on. These are the
 * questions somebody asks next: who hates this, who is sure about it, what came first. Each
 * one is a line, and every face finds a spot on that line without covering anybody else.
 *
 * Nothing here reads a sentence. Every position comes from a number the run already
 * measured and wrote down, which is why a face moving to the angry end of the screen is a
 * claim that can be checked by opening it.
 */

export type Spot = { x: number; y: number }

/**
 * Lay values out along a line, stacking anything that would collide.
 *
 * Placed in value order, each face taking the smallest step off the line that clears every
 * face already down, alternating above and below so the shape grows evenly. This is the
 * arrangement a swarm of bees makes, and it works here for the same reason: the position
 * along the line is the reading, and the position off it is only whatever was needed to
 * stay visible.
 */
export function swarm(values: number[], radii: number[], width: number, gap = 18): Spot[] {
  const spots: Spot[] = values.map(() => ({ x: 0, y: 0 }))
  const order = values
    .map((value, index) => ({ value, index }))
    // Ties break on index, so the same set always lays out the same way.
    .sort((a, b) => a.value - b.value || a.index - b.index)

  const placed: { x: number; y: number; r: number }[] = []
  const stride = 12

  for (const { value, index } of order) {
    const r = radii[index] ?? 22
    const x = (value - 0.5) * width

    let y = 0
    for (let attempt = 0; attempt < 400; attempt++) {
      // 0, +12, -12, +24, -24 and onward: the smallest move off the line that fits.
      const rung = Math.ceil(attempt / 2) * stride
      y = rung === 0 ? 0 : attempt % 2 === 1 ? rung : -rung

      const clashes = placed.some((other) => {
        const need = r + other.r + gap
        return Math.abs(x - other.x) < need && Math.abs(y - other.y) < need
      })
      if (!clashes) break
    }

    placed.push({ x, y, r })
    spots[index] = { x, y }
  }

  return spots
}

/** Fold a value on a known scale down to 0 at one end and 1 at the other. */
export function onScale(value: number, low: number, high: number): number {
  if (high === low) return 0.5
  return Math.max(0, Math.min(1, (value - low) / (high - low)))
}

/**
 * Fold a set of values onto 0 to 1 using the set's own ends.
 *
 * Only for readings with no natural scale, which is dates. Everything else has a real scale
 * and keeps it, so that a set of opinions which all feel roughly the same does not get
 * stretched across the screen as though they disagreed.
 */
export function onOwnScale(values: number[]): number[] {
  const low = Math.min(...values)
  const high = Math.max(...values)
  return values.map((v) => onScale(v, low, high))
}
