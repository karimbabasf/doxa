import { describe, expect, it } from 'vitest'
import { onOwnScale, onScale, swarm } from './arrange'

const clear = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  need: number,
) => Math.abs(a.x - b.x) >= need || Math.abs(a.y - b.y) >= need

describe('swarm', () => {
  it('puts the low value at one end and the high value at the other', () => {
    const spots = swarm([0, 1], [20, 20], 800)
    expect(spots[0].x).toBeLessThan(spots[1].x)
    expect(spots[0].x).toBeCloseTo(-400)
    expect(spots[1].x).toBeCloseTo(400)
  })

  it('leaves one face on the line rather than stacking it for no reason', () => {
    expect(swarm([0.5], [20], 800)).toEqual([{ x: 0, y: 0 }])
  })

  it('stacks faces that would land on top of each other', () => {
    const values = [0.5, 0.5, 0.5, 0.5]
    const spots = swarm(values, [20, 20, 20, 20], 800, 18)
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        expect(clear(spots[i], spots[j], 20 + 20 + 18)).toBe(true)
      }
    }
  })

  it('keeps every face clear of every other, whatever the values', () => {
    const values = Array.from({ length: 30 }, (_, i) => (i % 7) / 6)
    const radii = values.map((_, i) => 20 + (i % 4) * 4)
    const spots = swarm(values, radii, 900, 14)
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        expect(clear(spots[i], spots[j], radii[i] + radii[j] + 14)).toBe(true)
      }
    }
  })

  it('lays the same set out the same way every time', () => {
    const values = [0.2, 0.2, 0.9, 0.4]
    const radii = [20, 20, 20, 20]
    expect(swarm(values, radii, 800)).toEqual(swarm(values, radii, 800))
  })

  it('returns one spot per value, in the order they came in', () => {
    expect(swarm([0.9, 0.1], [20, 20], 800)).toHaveLength(2)
    expect(swarm([0.9, 0.1], [20, 20], 800)[0].x).toBeGreaterThan(0)
  })
})

describe('onScale', () => {
  it('folds a value onto its ends', () => {
    expect(onScale(-1, -1, 1)).toBe(0)
    expect(onScale(0, -1, 1)).toBe(0.5)
    expect(onScale(1, -1, 1)).toBe(1)
  })

  it('holds anything outside the ends at the ends', () => {
    expect(onScale(-9, -1, 1)).toBe(0)
    expect(onScale(9, -1, 1)).toBe(1)
  })

  it('puts a value in the middle when the scale has no width', () => {
    expect(onScale(5, 5, 5)).toBe(0.5)
  })
})

describe('onOwnScale', () => {
  it('stretches a set across the whole line', () => {
    expect(onOwnScale([10, 20, 30])).toEqual([0, 0.5, 1])
  })

  it('puts a set that is all one value in the middle', () => {
    expect(onOwnScale([7, 7, 7])).toEqual([0.5, 0.5, 0.5])
  })
})
