/**
 * The specimen renderer.
 *
 * Two stages. `renderField` builds a greyscale field from signed distance
 * primitives under a domain warp. `quantise` pushes that field through an
 * ordered dither matrix and returns one byte per pixel.
 *
 * Zero dependencies, no canvas, no framework imports, and no Math.random: every
 * random draw is seeded from `params.seed`, so the same work order always
 * strikes the same specimen. It runs in Node for tests and the certificate PNG,
 * and in the browser for the live preview.
 */

import type { RenderParams } from '../types'
import { mulberry32, fbm, type FbmOptions } from './noise'
import { bayerThresholds, type BayerSize } from './bayer'

/** The size the certificate and the floor preview both render at. */
export const DEFAULT_SIZE = 512

/** Byte values in the buffer `quantise` returns. */
export const GROUND = 0
export const INK = 1

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** A finite number pulled into range, falling back when a merge hands us junk. */
function clampTo(v: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback
  return v < lo ? lo : v > hi ? hi : v
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (!(edge1 > edge0)) return x < edge0 ? 0 : 1
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** Snap a merged matrix size onto the three sizes that exist. */
function matrixSize(v: number): BayerSize {
  const n = Math.round(Number.isFinite(v) ? v : 4)
  if (n < 3) return 2
  if (n < 6) return 4
  return 8
}

type Placement = { cx: Float64Array; cy: Float64Array; r: Float64Array; n: number }

/**
 * Circle centres and radii for one specimen.
 *
 * Both come off one `mulberry32(params.seed)` stream in a fixed order, so the
 * placement is reproducible. Scatter draws from that stream before the radii do,
 * which is why a scatter specimen differs from a radial one in more than layout.
 */
function placePrimitives(params: RenderParams, size: number): Placement {
  const count = clampTo(Math.round(params.primitives.count), 0, 512, 8)
  const rand = mulberry32(params.seed >>> 0)
  const cx = new Float64Array(count)
  const cy = new Float64Array(count)
  const r = new Float64Array(count)
  const mid = size / 2

  switch (params.primitives.arrangement) {
    case 'grid': {
      const cols = Math.max(1, Math.ceil(Math.sqrt(count)))
      const rows = Math.max(1, Math.ceil(count / cols))
      const stepX = size / (cols + 1)
      const stepY = size / (rows + 1)
      for (let i = 0; i < count; i++) {
        cx[i] = stepX * ((i % cols) + 1)
        cy[i] = stepY * (Math.floor(i / cols) + 1)
      }
      break
    }
    case 'spiral': {
      const span = size * 0.36
      const denom = Math.sqrt(Math.max(1, count - 1))
      for (let i = 0; i < count; i++) {
        const theta = i * 2.39996
        const rad = (span * Math.sqrt(i)) / denom
        cx[i] = mid + Math.cos(theta) * rad
        cy[i] = mid + Math.sin(theta) * rad
      }
      break
    }
    case 'scatter': {
      const inset = size * 0.12
      const span = size - inset * 2
      for (let i = 0; i < count; i++) {
        cx[i] = inset + rand() * span
        cy[i] = inset + rand() * span
      }
      break
    }
    default: {
      const ring = size * 0.32
      for (let i = 0; i < count; i++) {
        const theta = (i / Math.max(1, count)) * Math.PI * 2
        cx[i] = mid + Math.cos(theta) * ring
        cy[i] = mid + Math.sin(theta) * ring
      }
    }
  }

  const base = size * 0.06 * (0.5 + clampTo(params.primitives.sizeBias, -0.4, 4, 0.5))
  for (let i = 0; i < count; i++) r[i] = Math.max(1e-3, base * (0.7 + 0.6 * rand()))

  return { cx, cy, r, n: count }
}

/** What the field reads with no primitives to measure against. */
function emptyValue(type: RenderParams['field']['type']): number {
  return type === 'collapse' ? 1 : 0
}

/**
 * Build the greyscale field. Returns `size * size` values in [0, 1], row major,
 * top left origin, index `y * size + x`.
 */
export function renderField(params: RenderParams, size: number): Float32Array {
  const n = Math.max(1, Math.round(size))
  const out = new Float32Array(n * n)

  const type = params.field.type
  const scale = clampTo(params.field.scale, 0.05, 8, 1)
  const warpAmp = clampTo(params.field.warpAmp, -2, 2, 0)
  const warpFreq = clampTo(params.field.warpFreq, 0, 32, 1)
  const octaves = Math.round(clampTo(params.field.octaves, 1, 8, 4))
  const seed = params.seed | 0

  const prims = placePrimitives(params, n)
  const cxs = prims.cx
  const cys = prims.cy
  const rs = prims.r
  const pn = prims.n

  // Hoisted so the inner loop allocates nothing.
  const warpX: FbmOptions = { seed, octaves }
  const warpY: FbmOptions = { seed: seed + 7919, octaves }
  const breakUp: FbmOptions = { seed: seed + 104729, octaves }

  const warpScale = warpAmp * n
  const latticePeriod = Math.max(1e-6, n * 0.04)
  const breakFreq = (warpFreq + 1) * 3
  const summed = type === 'bloom' || type === 'fracture'

  const vignette = !params.frame.bleed
  const fill = clampTo(params.frame.fill, 0.02, 4, 0.6)
  const fillOuter = fill + 0.18
  const blank = emptyValue(type)

  for (let y = 0; y < n; y++) {
    const uy = ((y + 0.5) / n) * 2 - 1
    const row = y * n

    for (let x = 0; x < n; x++) {
      const i = row + x
      let v: number

      if (pn === 0) {
        v = blank
      } else {
        const fx = (x * warpFreq) / n
        const fy = (y * warpFreq) / n
        const wx = x + warpScale * fbm(fx, fy, warpX)
        const wy = y + warpScale * fbm(fx, fy, warpY)

        let near = Infinity
        let nearR = 1
        let sum = 0

        for (let p = 0; p < pn; p++) {
          const dx = wx - cxs[p]
          const dy = wy - cys[p]
          const r = rs[p]
          // Signed distance to this circle, with field.scale on the distance term.
          const d = (Math.sqrt(dx * dx + dy * dy) - r) * scale
          if (d < near) {
            near = d
            nearR = r
          }
          if (summed) sum += 1 - smoothstep(0, r, d)
        }

        if (type === 'bloom') {
          v = sum > 1 ? 1 : sum
        } else if (type === 'collapse') {
          v = smoothstep(0, nearR, near)
        } else if (type === 'lattice') {
          v = Math.abs(Math.sin(near / latticePeriod))
        } else {
          // fracture: bloom cut by a hard step on a second, faster field.
          const s = fbm((x * breakFreq) / n + 11.7, (y * breakFreq) / n - 4.3, breakUp)
          v = s > 0 ? (sum > 1 ? 1 : sum) : 0
        }
      }

      if (vignette) {
        const ux = ((x + 0.5) / n) * 2 - 1
        const rad = Math.sqrt(ux * ux + uy * uy)
        v *= 1 - smoothstep(fill, fillOuter, rad)
      }

      out[i] = clamp01(v)
    }
  }

  return out
}

/**
 * Quantise the field through the ordered dither matrix.
 *
 * Returns one byte per pixel, row major, top left origin, index `y * size + x`:
 * 0 is ground, 1 is ink. The palette is applied at paint time, not here.
 */
export function quantise(field: Float32Array, params: RenderParams, size: number): Uint8Array {
  const n = Math.max(1, Math.round(size))
  const out = new Uint8Array(n * n)

  const m = matrixSize(params.dither.matrix)
  const thresholds = bayerThresholds(m)
  const levels = Math.round(clampTo(params.dither.levels, 2, 64, 3))
  const contrast = clampTo(params.dither.contrast, 0, 8, 1)
  const bias = clampTo(params.dither.bias, -1, 1, 0)
  const steps = levels - 1

  for (let y = 0; y < n; y++) {
    const row = y * n
    const tRow = (y % m) * m

    for (let x = 0; x < n; x++) {
      const i = row + x
      const threshold = thresholds[tRow + (x % m)]
      const v = clamp01((field[i] - 0.5) * contrast + 0.5 + bias)
      const level = Math.floor(v * steps + threshold) / steps
      out[i] = level > 0.5 ? INK : GROUND
    }
  }

  return out
}

/** Field plus dither in one call. The entry point for the PNG encoder and the canvas. */
export function renderSpecimen(params: RenderParams, size: number = DEFAULT_SIZE): Uint8Array {
  const n = Math.max(1, Math.round(size))
  return quantise(renderField(params, n), params, n)
}
