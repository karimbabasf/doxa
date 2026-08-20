import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { renderField, quantise, renderSpecimen, DEFAULT_SIZE } from './render'
import type { RenderParams, FieldType, Arrangement } from '../types'

const P: RenderParams = {
  field: { type: 'bloom', scale: 1, warpAmp: 0.3, warpFreq: 1.2, octaves: 4 },
  primitives: { count: 8, arrangement: 'radial', sizeBias: 0.4 },
  dither: { matrix: 4, levels: 3, contrast: 0.9, bias: 0 },
  palette: { ink: '#c8f5d0', ground: '#0b1116' },
  frame: { fill: 0.6, bleed: false },
  seed: 12345,
}

/**
 * Recorded on the first green run. Any later change to the field or dither maths
 * has to fail here on purpose, rather than let the specimen drift quietly.
 */
const GOLDEN = 'b33bb2b303332745'

const hash = (u: Uint8Array) => createHash('sha256').update(u).digest('hex').slice(0, 16)
const q = (p: RenderParams, size = 64) => hash(quantise(renderField(p, size), p, size))

describe('render', () => {
  it('is deterministic for the same params and seed', () => {
    expect(hash(quantise(renderField(P, 64), P, 64))).toBe(hash(quantise(renderField(P, 64), P, 64)))
  })

  it('changes when the seed changes', () => {
    expect(q(P)).not.toBe(q({ ...P, seed: 999 }))
  })

  it('changes when the field type changes', () => {
    expect(q(P)).not.toBe(q({ ...P, field: { ...P.field, type: 'fracture' } }))
  })

  it('emits only ink and ground bytes', () => {
    const out = quantise(renderField(P, 64), P, 64)
    expect([...new Set(out)].sort()).toEqual([0, 1])
  })

  it('matches the recorded golden hash', () => {
    expect(hash(quantise(renderField(P, 64), P, 64))).toBe(GOLDEN)
  })

  it('gives every field type its own image', () => {
    const types: FieldType[] = ['bloom', 'collapse', 'lattice', 'fracture']
    const hashes = types.map((type) => q({ ...P, field: { ...P.field, type } }))
    expect(new Set(hashes).size).toBe(types.length)
  })

  it('gives every arrangement its own image', () => {
    const arrangements: Arrangement[] = ['radial', 'grid', 'spiral', 'scatter']
    const hashes = arrangements.map((arrangement) =>
      q({ ...P, primitives: { ...P.primitives, arrangement } }),
    )
    expect(new Set(hashes).size).toBe(arrangements.length)
  })

  it('returns a field of size squared values, all in [0, 1]', () => {
    const f = renderField(P, 48)
    expect(f).toBeInstanceOf(Float32Array)
    expect(f.length).toBe(48 * 48)
    for (let i = 0; i < f.length; i++) {
      expect(f[i]).toBeGreaterThanOrEqual(0)
      expect(f[i]).toBeLessThanOrEqual(1)
    }
  })

  it('returns one byte per pixel', () => {
    const out = quantise(renderField(P, 32), P, 32)
    expect(out).toBeInstanceOf(Uint8Array)
    expect(out.length).toBe(32 * 32)
  })

  it('responds to every field knob', () => {
    const base = q(P)
    expect(q({ ...P, field: { ...P.field, scale: 2.4 } })).not.toBe(base)
    expect(q({ ...P, field: { ...P.field, warpAmp: 0 } })).not.toBe(base)
    expect(q({ ...P, field: { ...P.field, warpFreq: 4 } })).not.toBe(base)
    expect(q({ ...P, field: { ...P.field, octaves: 1 } })).not.toBe(base)
  })

  it('responds to every primitive knob', () => {
    const base = q(P)
    expect(q({ ...P, primitives: { ...P.primitives, count: 3 } })).not.toBe(base)
    expect(q({ ...P, primitives: { ...P.primitives, sizeBias: 1.4 } })).not.toBe(base)
  })

  it('responds to every dither knob', () => {
    const base = q(P)
    expect(q({ ...P, dither: { ...P.dither, matrix: 8 } })).not.toBe(base)
    expect(q({ ...P, dither: { ...P.dither, levels: 6 } })).not.toBe(base)
    expect(q({ ...P, dither: { ...P.dither, contrast: 2.2 } })).not.toBe(base)
    expect(q({ ...P, dither: { ...P.dither, bias: 0.2 } })).not.toBe(base)
  })

  it('responds to the frame knobs', () => {
    const base = q(P)
    expect(q({ ...P, frame: { ...P.frame, fill: 0.3 } })).not.toBe(base)
    expect(q({ ...P, frame: { fill: P.frame.fill, bleed: true } })).not.toBe(base)
  })

  it('ignores the palette, which is applied at paint time and not at dither time', () => {
    expect(q({ ...P, palette: { ink: '#ffffff', ground: '#000000' } })).toBe(q(P))
  })

  it('keeps the vignette off when bleed is true, so the form reaches the corners', () => {
    const bled = quantise(renderField({ ...P, frame: { fill: 0.2, bleed: true } }, 64), P, 64)
    const framed = quantise(renderField({ ...P, frame: { fill: 0.2, bleed: false } }, 64), P, 64)
    const ink = (u: Uint8Array) => u.reduce((n, v) => n + v, 0)
    expect(ink(bled)).toBeGreaterThan(ink(framed))
  })

  it('renders every dither matrix size without a stray byte', () => {
    for (const matrix of [2, 4, 8] as const) {
      const p = { ...P, dither: { ...P.dither, matrix } }
      const out = quantise(renderField(p, 64), p, 64)
      expect(out.every((v) => v === 0 || v === 1)).toBe(true)
    }
  })

  it('survives degenerate params instead of emitting NaN', () => {
    const p: RenderParams = {
      ...P,
      field: { ...P.field, scale: 0, warpAmp: 0, warpFreq: 0, octaves: 0 },
      primitives: { ...P.primitives, count: 0, sizeBias: 0 },
      dither: { ...P.dither, levels: 1, contrast: 0, bias: 0 },
    }
    const f = renderField(p, 32)
    expect([...f].every(Number.isFinite)).toBe(true)
    expect(quantise(f, p, 32).every((v) => v === 0 || v === 1)).toBe(true)
  })

  it('renderSpecimen matches renderField piped through quantise', () => {
    expect(hash(renderSpecimen(P, 64))).toBe(q(P))
  })

  it('renderSpecimen defaults to DEFAULT_SIZE', () => {
    expect(renderSpecimen(P).length).toBe(DEFAULT_SIZE * DEFAULT_SIZE)
  })
})
