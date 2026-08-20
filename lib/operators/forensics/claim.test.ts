import { describe, it, expect, vi, beforeEach } from 'vitest'
import { chatJson } from '../../llm'
import { CLAIM_EX } from './claim'
import type { Ctx } from '../../types'

vi.mock('../../llm', () => ({ chatJson: vi.fn(), embed: vi.fn() }))

const mockChat = vi.mocked(chatJson)
const ctx = (opinion: string): Ctx => ({ opinion, batchId: 't', results: new Map() })

beforeEach(() => {
  mockChat.mockReset()
})

describe('CLAIM-EX', () => {
  it('returns the stripped claim in readings.claim', async () => {
    mockChat.mockResolvedValue({
      claim: 'Tabs are better than spaces for indentation.',
      checkable: false,
      subject: 'tabs',
    })
    const r = await CLAIM_EX.run(ctx('I honestly think tabs are just better than spaces, sorry.'))
    expect(r.id).toBe('CLAIM-EX')
    expect(r.readings.claim).toBe('Tabs are better than spaces for indentation.')
    expect(r.readings.subject).toBe('tabs')
  })

  it('stores checkable as the string yes or no, never a boolean', async () => {
    mockChat.mockResolvedValue({ claim: 'c', checkable: true, subject: 's' })
    const yes = await CLAIM_EX.run(ctx('Rust compiles slower than Go.'))
    expect(yes.readings.checkable).toBe('yes')

    mockChat.mockResolvedValue({ claim: 'c', checkable: false, subject: 's' })
    const no = await CLAIM_EX.run(ctx('Rust feels nicer to write.'))
    expect(no.readings.checkable).toBe('no')

    for (const r of [yes, no]) {
      expect(typeof r.readings.checkable).toBe('string')
      expect(['yes', 'no']).toContain(r.readings.checkable)
    }
  })

  it('sends the full opinion text in the prompt', async () => {
    const opinion = 'Remote work killed the junior engineer pipeline, and nobody wants to say it.'
    mockChat.mockResolvedValue({ claim: 'c', checkable: true, subject: 's' })
    await CLAIM_EX.run(ctx(opinion))

    const opts = mockChat.mock.calls[0][0] as { system: string; user: string; schema: object }
    expect(opts.user).toContain(opinion)
    expect(opts.system.length).toBeGreaterThan(0)
    expect(opts.schema).toBeTypeOf('object')
  })

  it('rethrows when the model call fails, rather than passing a blank claim downstream', async () => {
    mockChat.mockRejectedValue(new Error('NEAR AI /chat/completions failed with 503: busy'))
    await expect(CLAIM_EX.run(ctx('Anything at all.'))).rejects.toThrow(/503/)
  })
})
