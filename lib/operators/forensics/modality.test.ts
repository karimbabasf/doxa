import { describe, it, expect } from 'vitest'
import { MODALITY } from './modality'
import type { Ctx } from '../../types'

const ctx = (opinion: string): Ctx => ({ opinion, batchId: 't', results: new Map() })

const at = (r: { contributions?: { path: string; value: unknown }[] }, path: string) =>
  Number(r.contributions!.find((c) => c.path === path)!.value)

describe('MODALITY', () => {
  it('counts one modal of each strength and averages their force', async () => {
    const r = await MODALITY.run(ctx('You must stop. You should stop. You could stop.'))
    expect(r.readings.must).toBe(1)
    expect(r.readings.should).toBe(1)
    expect(r.readings.could).toBe(1)
    expect(r.readings.may).toBe(0)
    // (3*1 + 2*1 + 1*1) / (3 * 3)
    expect(Number(r.readings.modalForce)).toBeCloseTo(2 / 3, 10)
  })

  it('reads text with no modals as zero force', async () => {
    const r = await MODALITY.run(ctx('Cats exist.'))
    expect(r.readings.modalForce).toBe(0)
    expect(r.readings.must).toBe(0)
    expect(at(r, 'frame.fill')).toBeCloseTo(0.45, 10)
    expect(at(r, 'dither.bias')).toBeCloseTo(-0.15, 10)
  })

  it('reads "have to" as the strongest bucket', async () => {
    const r = await MODALITY.run(ctx('We have to leave.'))
    expect(r.readings.must).toBe(1)
    expect(Number(r.readings.modalForce)).toBe(1)
    expect(at(r, 'frame.fill')).toBeCloseTo(0.85, 10)
    expect(at(r, 'dither.bias')).toBeCloseTo(0.15, 10)
  })

  it('buckets "might" with could and keeps "may" separate', async () => {
    const r = await MODALITY.run(ctx('It may rain and it might snow.'))
    expect(r.readings.may).toBe(1)
    expect(r.readings.could).toBe(1)
    expect(Number(r.readings.modalForce)).toBeCloseTo(1 / 3, 10)
    expect(at(r, 'frame.fill')).toBeCloseTo(0.5833333, 6)
    expect(at(r, 'dither.bias')).toBeCloseTo(-0.05, 10)
  })

  it('buckets "ought" with should', async () => {
    const r = await MODALITY.run(ctx('You ought to try.'))
    expect(r.readings.should).toBe(1)
    expect(r.readings.must).toBe(0)
    expect(Number(r.readings.modalForce)).toBeCloseTo(2 / 3, 10)
  })

  it('fills a stronger demand more and pushes the dither brighter', async () => {
    const strong = await MODALITY.run(ctx('We have to leave.'))
    const weak = await MODALITY.run(ctx('We may leave.'))
    expect(at(strong, 'frame.fill')).toBeGreaterThan(at(weak, 'frame.fill'))
    expect(at(strong, 'dither.bias')).toBeGreaterThan(at(weak, 'dither.bias'))
  })

  it('carries a fixed weight on both claims', async () => {
    const r = await MODALITY.run(ctx('You must stop.'))
    expect(r.contributions).toHaveLength(2)
    for (const c of r.contributions!) expect(c.weight).toBeCloseTo(0.8 * 0.7, 10)
  })

  it('reports the real comparison count as ops', async () => {
    const r = await MODALITY.run(ctx('You must stop. You should stop. You could stop.'))
    expect(r.ops).toBe(7 * 9)
  })

  it('declares itself', () => {
    expect(MODALITY.id).toBe('MODALITY')
    expect(MODALITY.wing).toBe('forensics')
    expect(MODALITY.needs).toEqual([])
    expect(MODALITY.touches).toEqual(['frame.fill', 'dither.bias'])
  })
})
