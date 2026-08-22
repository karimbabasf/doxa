import { FACE_SIZE, type Face, type Tone } from '@/lib/face/plate'
import { BAYER4, hueFill } from '@/components/dither-kit/pixel'

/**
 * Painting a face.
 *
 * The one rule that matters here: a face is struck at one plate pixel per screen pixel, or
 * at a whole multiple of it, and never at anything in between. The dither IS the picture,
 * so any smooth scale averages neighbouring dots into flat grey and the face arrives as a
 * smudge. That cost this build two days, and it is the reason every size below is an
 * integer and `imageSmoothingEnabled` is off everywhere.
 */

/** Plate pixels per cell. Four is the smallest that lets the Bayer matrix show a pattern. */
export const CELL = 4

/** A struck face is this many plate pixels on a side. */
export const PLATE = FACE_SIZE * CELL

/** How much ink each tone carries, as a threshold against the Bayer matrix. */
const TONE_LEVEL: Record<Tone, number> = { 0: 0, 1: 0.34, 2: 0.68, 3: 1 }

/**
 * Strike one face onto a fresh canvas of exactly `PLATE` by `PLATE` plate pixels.
 *
 * Returned rather than drawn into a caller's context so the result can be cached: the chart
 * strikes each face once and blits it every frame, which is what keeps a hundred nodes at
 * sixty frames.
 */
export function strikeFace(face: Face, ground: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = PLATE
  canvas.height = PLATE
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  ctx.fillStyle = ground
  ctx.fillRect(0, 0, PLATE, PLATE)

  const [r, g, b] = hueFill(face.hue)
  ctx.fillStyle = `rgb(${r},${g},${b})`

  for (let cy = 0; cy < FACE_SIZE; cy++) {
    for (let cx = 0; cx < FACE_SIZE; cx++) {
      const level = TONE_LEVEL[face.cells[cy * FACE_SIZE + cx]]
      if (level === 0) continue

      for (let py = 0; py < CELL; py++) {
        for (let px = 0; px < CELL; px++) {
          const x = cx * CELL + px
          const y = cy * CELL + py
          // The Bayer threshold is read off the absolute plate position, not the position
          // inside the cell, so neighbouring cells at the same tone form one continuous
          // pattern instead of a grid of identical stamps.
          if (level > BAYER4[y % 4][x % 4]) ctx.fillRect(x, y, 1, 1)
        }
      }
    }
  }

  return canvas
}

/**
 * The largest whole number of screen pixels per plate pixel that fits in `box`.
 *
 * Never returns zero. A face asked to fit somewhere smaller than it was struck is drawn at
 * 1:1 and allowed to overflow its box, because a clipped face is still a face and a shrunk
 * one is grey mud.
 */
export function wholeScale(box: number): number {
  return Math.max(1, Math.floor(box / PLATE))
}

/** Blit a struck face with no smoothing, at a whole scale, centred on `x`, `y`. */
export function blitFace(
  ctx: CanvasRenderingContext2D,
  plate: HTMLCanvasElement,
  x: number,
  y: number,
  scale: number,
): void {
  const size = PLATE * scale
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(plate, Math.round(x - size / 2), Math.round(y - size / 2), size, size)
}
