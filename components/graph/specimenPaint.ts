/**
 * Specimens, painted in the browser.
 *
 * A node on the graph is its own specimen, not an icon standing in for one. The foundry
 * is already pure arithmetic over `RenderParams` with no node imports, so the same code
 * that struck the certificate's plate strikes the 44 pixel node, from the same parameters.
 * Nothing here invents a colour or a shape: it turns the run's ink and ground into pixels.
 */

import { renderSpecimen } from '@/lib/foundry/render'
import { INK } from '@/lib/foundry/render'
import { legiblePalette } from '@/lib/foundry/merge'
import type { RenderParams } from '@/lib/types'

/**
 * Specimens are expensive at large sizes and every one is deterministic, so each is
 * struck once per size and kept. The key carries the seed and the size because those are
 * the only two things that can change what comes out.
 */
const cache = new Map<string, HTMLCanvasElement>()

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ]
}

/**
 * Strike one specimen at `size` pixels and return it as a canvas ready to draw.
 *
 * Ground is left transparent rather than filled. On the graph a node sits over edges and
 * over the dot field, and a filled ground would punch an opaque square through both,
 * which reads as a sticker laid on the picture instead of a thing in it.
 */
export function specimenCanvas(
  params: RenderParams,
  size: number,
  opts: { opaqueGround?: boolean } = {},
): HTMLCanvasElement {
  const key = `${params.seed}@${size}@${opts.opaqueGround ? 'g' : 't'}`
  const hit = cache.get(key)
  if (hit) return hit

  const pixels = renderSpecimen(params, size)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const image = ctx.createImageData(size, size)
  // Batches struck before the legibility pass landed carry the raw operator colours,
  // and a real one is ink #1F3A93 on ground #0b1116: dark blue on near black, invisible.
  // The foundry's own function fixes it the same way the certificate does, and it is a
  // no-op on anything already above the contrast floor.
  const palette = legiblePalette(params.palette.ink, params.palette.ground)
  const [ir, ig, ib] = hexToRgb(palette.ink)
  const [gr, gg, gb] = hexToRgb(palette.ground)

  for (let i = 0; i < pixels.length; i++) {
    const o = i * 4
    if (pixels[i] === INK) {
      image.data[o] = ir
      image.data[o + 1] = ig
      image.data[o + 2] = ib
      image.data[o + 3] = 255
    } else if (opts.opaqueGround) {
      image.data[o] = gr
      image.data[o + 1] = gg
      image.data[o + 2] = gb
      image.data[o + 3] = 255
    } else {
      image.data[o + 3] = 0
    }
  }

  ctx.putImageData(image, 0, 0)
  cache.set(key, canvas)
  return canvas
}

/**
 * Node radius from the run's real operation count.
 *
 * Compressed hard on purpose. Operation counts run from the hundreds to the tens of
 * thousands, and a linear radius would make one node a speck beside a dinner plate.
 * The cube root keeps the ordering honest while keeping every node clickable.
 */
export function radiusForOps(ops: number, min = 17, max = 34): number {
  const scaled = Math.cbrt(Math.max(0, ops)) / Math.cbrt(32000)
  return min + Math.min(1, scaled) * (max - min)
}
