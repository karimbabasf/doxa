/**
 * The camera that flies the graph.
 *
 * Framerate independent exponential damping, the same model WARDEN's orb camera uses:
 * every frame the camera closes a fixed FRACTION of the remaining gap, scaled by real
 * elapsed time. A plain `current += (target - current) * 0.1` looks identical at 60fps
 * and then moves at half speed on a 120Hz display, because it closes that fraction per
 * FRAME rather than per second. This closes it per second, so the dive takes the same
 * wall clock time on a laptop and on a demo screen.
 */

export type Camera = {
  /** Screen position, in pixels, of the world origin. */
  x: number
  y: number
  /** Scale. 1 means one world unit per CSS pixel. */
  k: number
}

/** How fast the camera closes the gap. Higher is snappier. */
export const LAMBDA_PAN = 4.8
export const LAMBDA_ZOOM = 5.2

/** Longest step the damper will honour, so a stalled tab does not teleport the camera. */
export const MAX_STEP_SECONDS = 0.05

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt))
}

export function stepCamera(current: Camera, target: Camera, dtSeconds: number): Camera {
  const dt = Math.min(Math.max(dtSeconds, 0), MAX_STEP_SECONDS)
  return {
    x: damp(current.x, target.x, LAMBDA_PAN, dt),
    y: damp(current.y, target.y, LAMBDA_PAN, dt),
    k: damp(current.k, target.k, LAMBDA_ZOOM, dt),
  }
}

/**
 * The pose that frames a whole bounding box inside a viewport.
 *
 * `padding` is in screen pixels and applies after the scale, so the margin around the
 * cloud stays the same on screen whether the graph holds three opinions or three hundred.
 */
export function frameBox(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  viewport: { width: number; height: number },
  padding = 140,
  maxScale = 2.4,
): Camera {
  const boxWidth = Math.max(1, box.maxX - box.minX)
  const boxHeight = Math.max(1, box.maxY - box.minY)
  const usableWidth = Math.max(1, viewport.width - padding * 2)
  const usableHeight = Math.max(1, viewport.height - padding * 2)

  const k = Math.min(maxScale, Math.min(usableWidth / boxWidth, usableHeight / boxHeight))
  const centreX = (box.minX + box.maxX) / 2
  const centreY = (box.minY + box.maxY) / 2

  return {
    x: viewport.width / 2 - centreX * k,
    y: viewport.height / 2 - centreY * k,
    k,
  }
}

/**
 * The pose that puts one node at a chosen point on screen, at a chosen scale.
 *
 * The dive offsets its subject rather than centring it, because the pipeline unrolls to
 * one side and a centred node would sit underneath it.
 */
export function focusOn(
  world: { x: number; y: number },
  screen: { x: number; y: number },
  k: number,
): Camera {
  return { x: screen.x - world.x * k, y: screen.y - world.y * k, k }
}

/** Screen point to world point, for hit testing a click. */
export function toWorld(camera: Camera, screenX: number, screenY: number): { x: number; y: number } {
  return { x: (screenX - camera.x) / camera.k, y: (screenY - camera.y) / camera.k }
}

/** True once the camera is close enough that another frame would not be visible. */
export function settled(current: Camera, target: Camera): boolean {
  return (
    Math.abs(current.x - target.x) < 0.5 &&
    Math.abs(current.y - target.y) < 0.5 &&
    Math.abs(current.k - target.k) < 0.002
  )
}
