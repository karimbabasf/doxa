import { describe, it, expect } from 'vitest'
import { mulberry32, fbm } from './noise'

describe('mulberry32', () => {
  it('gives the same sequence for the same seed across separate calls', () => {
    const a = mulberry32(1)
    const b = mulberry32(1)
    const seqA = Array.from({ length: 16 }, () => a())
    const seqB = Array.from({ length: 16 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  it('gives a different sequence for a different seed', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    const seqA = Array.from({ length: 16 }, () => a())
    const seqB = Array.from({ length: 16 }, () => b())
    expect(seqA).not.toEqual(seqB)
  })

  it('returns every value in [0, 1)', () => {
    const r = mulberry32(987654)
    for (let i = 0; i < 5000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('advances, so two draws from one generator differ', () => {
    const r = mulberry32(42)
    const first = r()
    const second = r()
    expect(first).not.toBe(second)
  })
})

describe('fbm', () => {
  const grid: [number, number][] = []
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 10; j++) grid.push([i * 0.37 - 1.85, j * 0.41 - 2.05])
  }

  it('returns values in [-1, 1] for 100 sample points at 1 through 6 octaves', () => {
    for (let octaves = 1; octaves <= 6; octaves++) {
      for (const [x, y] of grid) {
        const v = fbm(x, y, { seed: 7, octaves })
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(-1)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('is deterministic for the same point, seed and octaves', () => {
    expect(fbm(0.3, -1.7, { seed: 11, octaves: 4 })).toBe(fbm(0.3, -1.7, { seed: 11, octaves: 4 }))
  })

  it('changes when the seed changes', () => {
    const a = grid.map(([x, y]) => fbm(x, y, { seed: 1, octaves: 3 }))
    const b = grid.map(([x, y]) => fbm(x, y, { seed: 2, octaves: 3 }))
    expect(a).not.toEqual(b)
  })

  it('changes when the octave count changes', () => {
    const a = grid.map(([x, y]) => fbm(x, y, { seed: 5, octaves: 1 }))
    const b = grid.map(([x, y]) => fbm(x, y, { seed: 5, octaves: 5 }))
    expect(a).not.toEqual(b)
  })

  it('is not constant across the sample grid', () => {
    const values = grid.map(([x, y]) => fbm(x, y, { seed: 3, octaves: 4 }))
    expect(new Set(values.map((v) => v.toFixed(6))).size).toBeGreaterThan(50)
  })

  it('is continuous, so a tiny step moves the value only a little', () => {
    const a = fbm(1.5, 0.5, { seed: 9, octaves: 4 })
    const b = fbm(1.5001, 0.5, { seed: 9, octaves: 4 })
    expect(Math.abs(a - b)).toBeLessThan(0.01)
  })
})
