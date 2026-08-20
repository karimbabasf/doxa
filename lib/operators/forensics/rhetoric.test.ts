import { describe, it, expect } from 'vitest'
import { RHETORIC } from './rhetoric'
import type { Ctx } from '../../types'

const ctx = (opinion: string): Ctx => ({ opinion, batchId: 't', results: new Map() })

const arrangement = (r: { contributions?: { path: string; value: unknown }[] }) =>
  String(r.contributions!.find((c) => c.path === 'primitives.arrangement')!.value)

describe('RHETORIC', () => {
  it('spots an analogy and arranges on a spiral', async () => {
    const r = await RHETORIC.run(ctx('React is basically jQuery with extra steps.'))
    expect(r.readings.analogy).toBe(1)
    expect(r.readings.hyperbole).toBe(0)
    expect(r.readings.authority).toBe(0)
    expect(r.readings.falseDilemma).toBe(0)
    expect(arrangement(r)).toBe('spiral')
  })

  it('spots hyperbole and arranges radially', async () => {
    const r = await RHETORIC.run(ctx('This is the single worst decision anyone has ever made.'))
    expect(Number(r.readings.hyperbole)).toBeGreaterThanOrEqual(1)
    expect(r.readings.hyperbole).toBe(2)
    expect(r.readings.analogy).toBe(0)
    expect(arrangement(r)).toBe('radial')
  })

  it('spots an appeal to authority and arranges on a grid', async () => {
    const r = await RHETORIC.run(ctx('Studies show that everyone agrees.'))
    expect(r.readings.authority).toBe(1)
    expect(r.readings.hyperbole).toBe(0)
    expect(arrangement(r)).toBe('grid')
  })

  it('counts one false dilemma once, not once per overlapping pattern', async () => {
    const r = await RHETORIC.run(ctx('You are either with us or against us.'))
    expect(r.readings.falseDilemma).toBe(1)
    expect(r.readings.analogy).toBe(0)
    expect(r.readings.hyperbole).toBe(0)
    expect(r.readings.authority).toBe(0)
    expect(arrangement(r)).toBe('scatter')
  })

  it('reads plain text as no device at all and falls back to a grid', async () => {
    const r = await RHETORIC.run(ctx('Cats exist.'))
    expect(r.readings.analogy).toBe(0)
    expect(r.readings.hyperbole).toBe(0)
    expect(r.readings.authority).toBe(0)
    expect(r.readings.falseDilemma).toBe(0)
    expect(arrangement(r)).toBe('grid')
    expect(r.contributions![0].weight).toBeCloseTo(0.8 * 0.2, 10)
  })

  it('keeps the superlative stoplist out of the hyperbole count', async () => {
    const r = await RHETORIC.run(ctx('This is the best test.'))
    expect(r.readings.hyperbole).toBe(0)
  })

  it('breaks a tie in device order, analogy first', async () => {
    const r = await RHETORIC.run(ctx('It is just the greatest.'))
    expect(r.readings.analogy).toBe(1)
    expect(r.readings.hyperbole).toBe(1)
    expect(arrangement(r)).toBe('spiral')
    expect(r.contributions![0].weight).toBeCloseTo(0.8 * (2 * 0.35 + 0.2), 10)
  })

  it('caps the weight once enough devices fire', async () => {
    const r = await RHETORIC.run(
      ctx('Studies show it is just the greatest, and everyone knows it is ever thus.'),
    )
    expect(r.contributions![0].weight).toBeCloseTo(0.8, 10)
  })

  it('reports the real comparison count as ops', async () => {
    const r = await RHETORIC.run(ctx('Cats exist.'))
    expect(r.ops).toBe(18 * 2)
  })

  it('declares itself', () => {
    expect(RHETORIC.id).toBe('RHETORIC')
    expect(RHETORIC.wing).toBe('forensics')
    expect(RHETORIC.needs).toEqual([])
    expect(RHETORIC.touches).toEqual(['primitives.arrangement'])
  })
})
