import { describe, it, expect, vi, beforeEach } from 'vitest'
import { chatJson } from '../../llm'
import { STANCE } from './stance'
import { WING_WEIGHT } from '../../types'
import type { Ctx, OperatorResult } from '../../types'

vi.mock('../../llm', () => ({ chatJson: vi.fn(), embed: vi.fn() }))

const mockChat = vi.mocked(chatJson)

const CLAIM = 'Remote work broke the junior engineer pipeline.'

const claimResult = (claim: string): OperatorResult => ({
  id: 'CLAIM-EX',
  ops: 1,
  readings: { claim, checkable: 'yes', subject: 'remote work' },
})

const ctx = (claim: string = CLAIM): Ctx => ({
  opinion: 'Honestly, remote work broke the junior pipeline and nobody says it.',
  batchId: 't',
  results: new Map([['CLAIM-EX', claimResult(claim)]]),
})

const bleed = (r: OperatorResult) => (r.contributions ?? []).find((c) => c.path === 'frame.bleed')

beforeEach(() => {
  mockChat.mockReset()
})

describe('STANCE', () => {
  it('declares its dependency and the one path it writes', () => {
    expect(STANCE.id).toBe('STANCE')
    expect(STANCE.wing).toBe('semantics')
    expect(STANCE.needs).toEqual(['CLAIM-EX'])
    expect(STANCE.touches).toEqual(['frame.bleed'])
  })

  it('bleeds the frame when the writer is for the claim', async () => {
    mockChat.mockResolvedValue({ stance: 'for', confidence: 0.9 })
    const r = await STANCE.run(ctx())
    expect(r.readings.stance).toBe('for')
    expect(r.readings.confidence).toBeCloseTo(0.9, 12)
    expect(bleed(r)?.value).toBe(true)
  })

  it('holds the frame when the writer is against the claim', async () => {
    mockChat.mockResolvedValue({ stance: 'against', confidence: 0.9 })
    const r = await STANCE.run(ctx())
    expect(r.readings.stance).toBe('against')
    expect(bleed(r)?.value).toBe(false)
  })

  it('treats a mixed stance as no bleed, since only a clear for earns the edge', async () => {
    mockChat.mockResolvedValue({ stance: 'mixed', confidence: 0.8 })
    const r = await STANCE.run(ctx())
    expect(r.readings.stance).toBe('mixed')
    expect(bleed(r)?.value).toBe(false)
  })

  it('scales its own weight by its confidence', async () => {
    mockChat.mockResolvedValue({ stance: 'for', confidence: 0.9 })
    const sure = await STANCE.run(ctx())
    expect(bleed(sure)?.weight).toBeCloseTo(WING_WEIGHT.semantics * 0.9, 12)

    mockChat.mockResolvedValue({ stance: 'for', confidence: 0.3 })
    const unsure = await STANCE.run(ctx())
    expect(bleed(unsure)?.weight).toBeCloseTo(WING_WEIGHT.semantics * 0.3, 12)
    expect(bleed(unsure)?.weight as number).toBeLessThan(WING_WEIGHT.semantics * 0.5)
    expect(bleed(unsure)?.weight as number).toBeLessThan(bleed(sure)?.weight as number)
  })

  it('clamps a confidence the model reports outside 0 to 1', async () => {
    mockChat.mockResolvedValue({ stance: 'for', confidence: 4 })
    const high = await STANCE.run(ctx())
    expect(high.readings.confidence).toBe(1)
    expect(bleed(high)?.weight).toBeCloseTo(WING_WEIGHT.semantics, 12)

    mockChat.mockResolvedValue({ stance: 'against', confidence: -2 })
    const low = await STANCE.run(ctx())
    expect(low.readings.confidence).toBe(0)
    expect(bleed(low)?.weight).toBe(0)
  })

  it('asks about the extracted claim, not the raw opinion', async () => {
    mockChat.mockResolvedValue({ stance: 'for', confidence: 0.5 })
    await STANCE.run(ctx())
    const opts = mockChat.mock.calls[0][0] as { system: string; user: string; schema: object }
    expect(opts.user).toContain(CLAIM)
    expect(opts.system.length).toBeGreaterThan(0)
    expect(opts.schema).toBeTypeOf('object')
  })

  it('throws when CLAIM-EX has not run, rather than reading an empty claim', async () => {
    const bare: Ctx = { opinion: 'x', batchId: 't', results: new Map() }
    await expect(STANCE.run(bare)).rejects.toThrow(/CLAIM-EX/)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('throws when the model returns a stance outside the three it may choose', async () => {
    mockChat.mockResolvedValue({ stance: 'undecided', confidence: 0.9 })
    await expect(STANCE.run(ctx())).rejects.toThrow(/stance/i)
  })

  it('rethrows when the model call fails', async () => {
    mockChat.mockRejectedValue(new Error('NEAR AI /chat/completions failed with 503: busy'))
    await expect(STANCE.run(ctx())).rejects.toThrow(/503/)
  })
})
