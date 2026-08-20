/**
 * Ordered dither (Bayer) threshold matrices, built recursively from the 2x2 base.
 *
 * M(2n)[y][x] = 4 * M(n)[y % n][x % n] + M(2)[floor(y / n)][floor(x / n)]
 *
 * Every matrix holds each value from 0 to n squared minus one exactly once, which
 * is what makes the ordered dither spread its error evenly instead of clumping.
 */

export type BayerSize = 2 | 4 | 8

const BASE: number[][] = [
  [0, 2],
  [3, 1],
]

const cache = new Map<BayerSize, number[][]>()
const thresholdCache = new Map<BayerSize, Float32Array>()

function build(n: BayerSize): number[][] {
  if (n === 2) return BASE.map((row) => row.slice())

  const half = (n / 2) as BayerSize
  const small = build(half)
  const out: number[][] = []

  for (let y = 0; y < n; y++) {
    const row = new Array<number>(n)
    for (let x = 0; x < n; x++) {
      row[x] = 4 * small[y % half][x % half] + BASE[Math.floor(y / half)][Math.floor(x / half)]
    }
    out.push(row)
  }
  return out
}

/** The n by n Bayer matrix. Callers get a fresh copy, so the cache cannot be mutated. */
export function bayer(n: BayerSize): number[][] {
  let m = cache.get(n)
  if (!m) {
    m = build(n)
    cache.set(n, m)
  }
  return m.map((row) => row.slice())
}

/**
 * The same matrix pre-divided into thresholds in (0, 1) and flattened, which is the
 * form the render inner loop wants. Cached and shared, so it is read only by contract.
 */
export function bayerThresholds(n: BayerSize): Float32Array {
  let out = thresholdCache.get(n)
  if (out) return out

  const m = bayer(n)
  const denom = n * n
  out = new Float32Array(denom)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) out[y * n + x] = (m[y][x] + 0.5) / denom
  }
  thresholdCache.set(n, out)
  return out
}
