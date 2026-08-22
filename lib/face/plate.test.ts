import { describe, it, expect } from 'vitest'
import { FACE_SIZE, HUE_HIGH, HUE_LOW, digest, faceFor, numbersOf } from './plate'

describe('faceFor', () => {
  it('draws the same face for the same measurements', () => {
    const input = { numbers: [1, 2.5, 90, 0.331], tools: 9 }
    expect(faceFor(input)).toEqual(faceFor({ ...input }))
  })

  it('draws a different face when one measurement changes', () => {
    const a = faceFor({ numbers: [1, 2.5, 90, 0.331], tools: 9 })
    const b = faceFor({ numbers: [1, 2.5, 90, 0.332], tools: 9 })
    expect(a.cells).not.toEqual(b.cells)
  })

  it('is symmetric left to right, so the mark reads as a thing and not as noise', () => {
    const face = faceFor({ numbers: [7, 13, 21], tools: 12 })
    for (let y = 0; y < FACE_SIZE; y++) {
      for (let x = 0; x < FACE_SIZE; x++) {
        expect(face.cells[y * FACE_SIZE + x]).toBe(
          face.cells[y * FACE_SIZE + (FACE_SIZE - 1 - x)],
        )
      }
    }
  })

  it('fills the grid completely and only with the four tones', () => {
    const face = faceFor({ numbers: [3, 4], tools: 4 })
    expect(face.cells).toHaveLength(FACE_SIZE * FACE_SIZE)
    for (const cell of face.cells) expect([0, 1, 2, 3]).toContain(cell)
  })

  it('carries more ink when more tools reported', () => {
    const numbers = [5, 6, 7, 8]
    const quiet = faceFor({ numbers, tools: 1 })
    const busy = faceFor({ numbers, tools: 16 })
    expect(busy.ink).toBeGreaterThan(quiet.ink)
  })

  it('never leaves a one tool run with a blank square', () => {
    for (let i = 0; i < 40; i++) {
      const face = faceFor({ numbers: [i, i * 1.7], tools: 1 })
      expect(face.ink).toBeGreaterThan(0)
    }
  })

  it('keeps every face inside the one colour family', () => {
    for (let i = 0; i < 200; i++) {
      const { hue } = faceFor({ numbers: [i * 3.3, i], tools: 5 })
      expect(hue).toBeGreaterThanOrEqual(HUE_LOW)
      expect(hue).toBeLessThan(HUE_HIGH)
    }
  })

  it('still draws something when the run measured nothing', () => {
    const face = faceFor({ numbers: [], tools: 0 })
    expect(face.cells).toHaveLength(FACE_SIZE * FACE_SIZE)
  })
})

describe('digest', () => {
  it('ignores a difference below the rounding floor', () => {
    expect(digest([0.1234567])).toBe(digest([0.12345671]))
  })

  it('drops values that are not real numbers', () => {
    expect(digest([1, NaN, 2, Infinity])).toBe(digest([1, 2]))
  })
})

describe('numbersOf', () => {
  it('takes the numeric readings and leaves the words', () => {
    const results: { readings: Record<string, number | string> }[] = [
      { readings: { words: 12, verdict: 'hedged', depth: 3.5 } },
      { readings: { repaired: 'yes', sources: 24 } },
    ]
    expect(numbersOf(results)).toEqual([12, 3.5, 24])
  })
})
