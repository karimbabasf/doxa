import { describe, expect, it } from 'vitest'
import {
  LAMBDA_PAN,
  MAX_STEP_SECONDS,
  damp,
  focusOn,
  frameBox,
  settled,
  stepCamera,
  toWorld,
  type Camera,
} from './camera'

const at = (x: number, y: number, k = 1): Camera => ({ x, y, k })

describe('damp', () => {
  it('does not move on a zero step', () => {
    expect(damp(0, 100, LAMBDA_PAN, 0)).toBe(0)
  })

  it('closes the documented fraction of the gap in one second', () => {
    // 1 - e^-4.8 is about 0.9918.
    expect(damp(0, 100, LAMBDA_PAN, 1)).toBeCloseTo(100 * (1 - Math.exp(-4.8)), 10)
  })

  it('approaches the target without overshooting it', () => {
    let value = 0
    for (let i = 0; i < 200; i++) value = damp(value, 100, LAMBDA_PAN, 1 / 60)
    expect(value).toBeLessThanOrEqual(100)
    expect(value).toBeCloseTo(100, 4)
  })

  it('is framerate independent: two half steps land where one whole step lands', () => {
    const whole = damp(0, 100, LAMBDA_PAN, 1 / 60)
    const half = damp(damp(0, 100, LAMBDA_PAN, 1 / 120), 100, LAMBDA_PAN, 1 / 120)
    expect(half).toBeCloseTo(whole, 12)
  })
})

describe('stepCamera', () => {
  it('clamps a long step, so a stalled tab does not teleport the camera', () => {
    const long = stepCamera(at(0, 0, 1), at(1000, 1000, 4), 10)
    const clamped = stepCamera(at(0, 0, 1), at(1000, 1000, 4), MAX_STEP_SECONDS)
    expect(long).toEqual(clamped)
  })

  it('treats a negative step as no step', () => {
    expect(stepCamera(at(5, 6, 2), at(500, 600, 9), -1)).toEqual(at(5, 6, 2))
  })

  it('moves every axis toward its target', () => {
    const next = stepCamera(at(0, 0, 1), at(100, -100, 3), 1 / 60)
    expect(next.x).toBeGreaterThan(0)
    expect(next.y).toBeLessThan(0)
    expect(next.k).toBeGreaterThan(1)
  })
})

describe('frameBox', () => {
  const viewport = { width: 1000, height: 800 }

  it('puts the box centre at the viewport centre', () => {
    const cam = frameBox({ minX: -100, minY: -50, maxX: 300, maxY: 150 }, viewport)
    // Box centre is (100, 50).
    expect(cam.x + 100 * cam.k).toBeCloseTo(500, 9)
    expect(cam.y + 50 * cam.k).toBeCloseTo(400, 9)
  })

  it('never scales past the cap, so a lone node does not fill the screen', () => {
    const cam = frameBox({ minX: -5, minY: -5, maxX: 5, maxY: 5 }, viewport, 90, 1.1)
    expect(cam.k).toBe(1.1)
  })

  it('shrinks to fit a box wider than the viewport', () => {
    const cam = frameBox({ minX: -2000, minY: -100, maxX: 2000, maxY: 100 }, viewport)
    expect(cam.k).toBeLessThan(1)
    expect(4000 * cam.k).toBeLessThanOrEqual(viewport.width - 180 + 0.001)
  })

  it('survives a zero-size box rather than dividing by zero', () => {
    const cam = frameBox({ minX: 7, minY: 7, maxX: 7, maxY: 7 }, viewport)
    expect(Number.isFinite(cam.x)).toBe(true)
    expect(Number.isFinite(cam.k)).toBe(true)
    expect(cam.k).toBeGreaterThan(0)
  })

  it('survives a zero-size viewport, which is what the first frame reports', () => {
    const cam = frameBox({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { width: 0, height: 0 })
    expect(Number.isFinite(cam.k)).toBe(true)
    expect(cam.k).toBeGreaterThan(0)
  })
})

describe('focusOn', () => {
  it('lands the world point exactly on the requested screen point', () => {
    const cam = focusOn({ x: 250, y: -80 }, { x: 320, y: 400 }, 2.4)
    expect(cam.x + 250 * cam.k).toBeCloseTo(320, 9)
    expect(cam.y + -80 * cam.k).toBeCloseTo(400, 9)
  })
})

describe('toWorld', () => {
  it('inverts the camera transform', () => {
    const cam = at(120, -40, 1.7)
    const world = { x: 33, y: -12 }
    const screenX = cam.x + world.x * cam.k
    const screenY = cam.y + world.y * cam.k
    const back = toWorld(cam, screenX, screenY)
    expect(back.x).toBeCloseTo(world.x, 9)
    expect(back.y).toBeCloseTo(world.y, 9)
  })
})

describe('settled', () => {
  it('is false while a move is still visible', () => {
    expect(settled(at(0, 0, 1), at(40, 0, 1))).toBe(false)
  })

  it('is true within a sub-pixel of the target', () => {
    expect(settled(at(0.2, -0.1, 1.0005), at(0, 0, 1))).toBe(true)
  })
})
