import { describe, expect, it } from 'vitest'
import { packClumps, roomFor, type Clump } from './pack'

const apart = (
  a: { x: number; y: number },
  b: { x: number; y: number },
) => Math.hypot(a.x - b.x, a.y - b.y)

describe('packClumps', () => {
  it('gives one clump the middle', () => {
    expect(packClumps([{ group: 0, radius: 120 }])).toEqual(new Map([[0, { x: 0, y: 0 }]]))
  })

  it('leaves clear space between every pair, whatever their sizes', () => {
    const clumps: Clump[] = [
      { group: 0, radius: 60 },
      { group: 1, radius: 200 },
      { group: 2, radius: 95 },
      { group: 3, radius: 140 },
      { group: 4, radius: 60 },
      { group: 5, radius: 310 },
    ]
    const gap = 100
    const spots = packClumps(clumps, gap)

    for (const a of clumps) {
      for (const b of clumps) {
        if (a.group >= b.group) continue
        const spotA = spots.get(a.group)
        const spotB = spots.get(b.group)
        expect(spotA).toBeDefined()
        expect(spotB).toBeDefined()
        // Stretching sideways only adds distance, so the round clearance still holds.
        expect(apart(spotA!, spotB!)).toBeGreaterThanOrEqual(a.radius + b.radius + gap - 1)
      }
    }
  })

  it('packs the same clumps into the same places every time', () => {
    const clumps: Clump[] = [
      { group: 2, radius: 90 },
      { group: 0, radius: 150 },
      { group: 1, radius: 90 },
    ]
    expect(packClumps(clumps)).toEqual(packClumps([...clumps].reverse()))
  })

  it('gives a spot to every clump', () => {
    const spots = packClumps([
      { group: 4, radius: 40 },
      { group: 7, radius: 40 },
      { group: 9, radius: 40 },
    ])
    expect([...spots.keys()].sort((a, b) => a - b)).toEqual([4, 7, 9])
  })

  it('lays the arrangement out wider than it is tall, because screens are', () => {
    const clumps: Clump[] = Array.from({ length: 7 }, (_, i) => ({ group: i, radius: 100 }))
    const spots = [...packClumps(clumps).values()]
    const width = Math.max(...spots.map((s) => s.x)) - Math.min(...spots.map((s) => s.x))
    const height = Math.max(...spots.map((s) => s.y)) - Math.min(...spots.map((s) => s.y))
    expect(width).toBeGreaterThan(height)
  })

  it('handles no clumps at all', () => {
    expect(packClumps([]).size).toBe(0)
  })
})

describe('roomFor', () => {
  it('gives a bigger clump more room', () => {
    expect(roomFor(9, [30], 20)).toBeGreaterThan(roomFor(2, [30], 20))
  })

  it('gives a clump of bigger faces more room', () => {
    expect(roomFor(4, [60], 20)).toBeGreaterThan(roomFor(4, [20], 20))
  })

  it('always leaves room for the one face it holds', () => {
    expect(roomFor(1, [40], 20)).toBeGreaterThan(40)
  })
})
