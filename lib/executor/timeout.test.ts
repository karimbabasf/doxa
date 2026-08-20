/**
 * Measured 2026-08-20 against the real Bright Data CLI: one Tildes group took 115s, because
 * the free tier drops out of realtime into batch mode. The flat 45s ceiling cut CORROBORATE
 * on its first ever live run while every forensics operator finished in milliseconds.
 */
import { describe, it, expect } from 'vitest'
import { timeoutFor, TIMEOUT_HEADROOM } from './run'
import type { Operator } from '../types'

const op = (estMs: number): Operator => ({
  id: 'X', name: 'X', wing: 'field', blurb: '', needs: [],
  costUnits: 1, estMs, estOps: 1, touches: [],
  run: async () => ({ id: 'X', ops: 1, readings: {} }),
})

describe('timeoutFor', () => {
  it('gives a field operator time proportional to what it declares', () => {
    expect(timeoutFor(op(120_000), 45_000)).toBe(120_000 * TIMEOUT_HEADROOM)
  })

  it('covers the 115s scrape that the flat ceiling cut', () => {
    expect(timeoutFor(op(120_000), 45_000)).toBeGreaterThan(115_000)
  })

  it('never drops below the global floor the caller asked for', () => {
    expect(timeoutFor(op(10), 45_000)).toBe(45_000)
  })

  it('falls back to the floor when estMs is missing or nonsense', () => {
    expect(timeoutFor(op(0), 45_000)).toBe(45_000)
    expect(timeoutFor(op(Number.NaN), 45_000)).toBe(45_000)
    expect(timeoutFor(op(-5), 45_000)).toBe(45_000)
  })
})
