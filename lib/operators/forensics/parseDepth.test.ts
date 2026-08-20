import { describe, it, expect } from 'vitest'
import { PARSE_DEPTH } from './parseDepth'
import type { Ctx } from '../../types'

const ctx = (opinion: string): Ctx => ({ opinion, batchId: 't', results: new Map() })

const octaves = (r: { contributions?: { path: string; value: unknown }[] }) =>
  Number(r.contributions!.find((c) => c.path === 'field.octaves')!.value)

const NESTED = 'Cats rule, because they are quiet, which matters.'
const DEEP =
  'It works, because it is simple, which matters, although it is slow, while we wait, since nobody complains, unless it breaks.'

describe('PARSE-DEPTH', () => {
  it('reads a bare sentence as one clause at depth one', async () => {
    const r = await PARSE_DEPTH.run(ctx('Cats rule.'))
    expect(r.readings.clauseCount).toBe(1)
    expect(r.readings.nestingDepth).toBe(1)
    expect(octaves(r)).toBe(3)
  })

  it('reads two subordinated clauses as three clauses at depth three', async () => {
    const r = await PARSE_DEPTH.run(ctx(NESTED))
    expect(r.readings.clauseCount).toBe(3)
    expect(r.readings.nestingDepth).toBe(3)
    expect(octaves(r)).toBe(4)
  })

  it('counts a comma and the subordinator right after it as one break', async () => {
    const withComma = await PARSE_DEPTH.run(ctx('Cats rule, because they are quiet.'))
    const withoutComma = await PARSE_DEPTH.run(ctx('Cats rule because they are quiet.'))
    expect(withComma.readings.nestingDepth).toBe(2)
    expect(withoutComma.readings.nestingDepth).toBe(2)
  })

  it('totals clauses across sentences but takes depth from the deepest one', async () => {
    const r = await PARSE_DEPTH.run(ctx(`${NESTED} Dogs bark.`))
    expect(r.readings.clauseCount).toBe(4)
    expect(r.readings.nestingDepth).toBe(3)
  })

  it('clamps octaves at six however deep the nesting goes', async () => {
    const r = await PARSE_DEPTH.run(ctx(DEEP))
    expect(r.readings.clauseCount).toBe(7)
    expect(r.readings.nestingDepth).toBe(7)
    expect(octaves(r)).toBe(6)
  })

  it('handles empty text without dividing by zero', async () => {
    const r = await PARSE_DEPTH.run(ctx('   '))
    expect(r.readings.clauseCount).toBe(0)
    expect(r.readings.nestingDepth).toBe(1)
    expect(r.ops).toBe(0)
  })

  it('carries a fixed weight', async () => {
    const r = await PARSE_DEPTH.run(ctx(NESTED))
    expect(r.contributions![0].weight).toBeCloseTo(0.8 * 0.6, 10)
  })

  it('reports the real scan count as ops', async () => {
    const r = await PARSE_DEPTH.run(ctx('Cats rule.'))
    expect(r.ops).toBe('Cats rule.'.length + 0 + 1)
    const nested = await PARSE_DEPTH.run(ctx(NESTED))
    expect(nested.ops).toBe(NESTED.length + 4 + 3)
  })

  it('declares itself', () => {
    expect(PARSE_DEPTH.id).toBe('PARSE-DEPTH')
    expect(PARSE_DEPTH.wing).toBe('forensics')
    expect(PARSE_DEPTH.needs).toEqual([])
    expect(PARSE_DEPTH.touches).toEqual(['field.octaves'])
  })
})
