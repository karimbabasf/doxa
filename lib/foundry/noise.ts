/**
 * Seeded randomness and value noise for the foundry.
 *
 * Zero dependencies and no global state: every source of randomness is threaded
 * from `params.seed`, so a specimen is reproducible from its work order alone.
 * Nothing here calls Math.random.
 */

/** The standard 32 bit mulberry32 PRNG. Returns a generator of values in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Integer hash of a lattice point, returned in [-1, 1].
 * All multiplies go through Math.imul so the result stays exact in 32 bits.
 */
function hashLattice(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h = (h ^ (h >>> 16)) >>> 0
  return (h / 4294967295) * 2 - 1
}

/** Cubic smoothstep on a fraction already in [0, 1]. */
function ease(t: number): number {
  return t * t * (3 - 2 * t)
}

/** One octave of value noise: hashed lattice, smoothstep interpolated. Range [-1, 1]. */
function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const ux = ease(x - x0)
  const uy = ease(y - y0)

  const n00 = hashLattice(x0, y0, seed)
  const n10 = hashLattice(x0 + 1, y0, seed)
  const n01 = hashLattice(x0, y0 + 1, seed)
  const n11 = hashLattice(x0 + 1, y0 + 1, seed)

  const top = n00 + (n10 - n00) * ux
  const bottom = n01 + (n11 - n01) * ux
  return top + (bottom - top) * uy
}

export type FbmOptions = { seed: number; octaves: number }

/**
 * Fractional Brownian motion over value noise: amplitude halves and frequency
 * doubles per octave, normalised by the amplitude sum so the result stays in
 * [-1, 1] whatever the octave count.
 */
export function fbm(x: number, y: number, opts: FbmOptions): number {
  const octaves = Math.max(1, Math.min(12, Math.round(opts.octaves) || 1))
  const seed = opts.seed | 0

  let amp = 1
  let freq = 1
  let sum = 0
  let norm = 0

  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 1013)
    norm += amp
    amp *= 0.5
    freq *= 2
  }

  const v = sum / norm
  return v < -1 ? -1 : v > 1 ? 1 : v
}
