/**
 * A real run struck ink #1F3A93 on ground #0b1116: dark blue on near black, every reading
 * behind it correct, and the specimen unreadable. On a projector that is indistinguishable
 * from a bug, so the foundry now guarantees the mark is visible against its ground.
 */
import { describe, it, expect } from 'vitest'
import { legiblePalette, MIN_INK_CONTRAST } from './merge'

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  const ch = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255)
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('legiblePalette', () => {
  it('fixes the exact pair a live run produced', () => {
    const before = ratio('#1F3A93', '#0b1116')
    const after = legiblePalette('#1F3A93', '#0b1116')
    expect(before).toBeLessThan(MIN_INK_CONTRAST)
    expect(ratio(after.ink, after.ground)).toBeGreaterThanOrEqual(MIN_INK_CONTRAST)
  })

  it('never moves the ground, so the field wing reading survives', () => {
    expect(legiblePalette('#1F3A93', '#0b1116').ground).toBe('#0b1116')
  })

  it('leaves an already legible pair untouched', () => {
    const p = legiblePalette('#ffffff', '#000000')
    expect(p).toEqual({ ink: '#ffffff', ground: '#000000' })
  })

  it('darkens the ink on a light ground instead of lightening it', () => {
    const p = legiblePalette('#dddd88', '#ffffff')
    expect(lum(p.ink)).toBeLessThan(lum('#dddd88'))
    expect(ratio(p.ink, p.ground)).toBeGreaterThanOrEqual(MIN_INK_CONTRAST)
  })

  it('is deterministic', () => {
    expect(legiblePalette('#1F3A93', '#0b1116')).toEqual(legiblePalette('#1F3A93', '#0b1116'))
  })

  it('passes through anything that is not a hex pair rather than guessing', () => {
    expect(legiblePalette('rebeccapurple', '#0b1116').ink).toBe('rebeccapurple')
  })

  it('reaches the floor for every topic ink in the catalogue on the darkest ground', () => {
    const inks = ['#1F3A93','#A21CAF','#4A4E69','#0F766E','#86124A','#D24E01','#A9662B','#6D28D9',
                  '#23272F','#55801A','#C1121F','#0369A1','#8A6A00','#2D6A4F','#0E7490','#4C1D95']
    for (const ink of inks) {
      const p = legiblePalette(ink, '#0b1116')
      expect(ratio(p.ink, p.ground)).toBeGreaterThanOrEqual(MIN_INK_CONTRAST)
    }
  })
})
