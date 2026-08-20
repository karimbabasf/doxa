import { describe, it, expect } from 'vitest'
import { bayer } from './bayer'

describe('bayer', () => {
  it('returns the canonical 2x2', () => {
    expect(bayer(2)).toEqual([[0, 2], [3, 1]])
  })

  it('returns an n by n matrix', () => {
    expect(bayer(8).length).toBe(8)
    expect(bayer(8)[0].length).toBe(8)
  })

  it('contains every value from 0 to n squared minus one exactly once', () => {
    const flat = bayer(4).flat().sort((a, b) => a - b)
    expect(flat).toEqual(Array.from({ length: 16 }, (_, i) => i))
  })

  it('contains every value from 0 to 63 exactly once at 8x8', () => {
    const flat = bayer(8).flat().sort((a, b) => a - b)
    expect(flat).toEqual(Array.from({ length: 64 }, (_, i) => i))
  })

  it('returns the canonical 4x4', () => {
    expect(bayer(4)).toEqual([
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ])
  })

  it('hands back a fresh array each call, so a caller cannot corrupt the cache', () => {
    const first = bayer(4)
    first[0][0] = 999
    expect(bayer(4)[0][0]).toBe(0)
  })
})
