import { describe, it, expect, vi, beforeEach } from 'vitest'
import { triggerCollector, healCollector, PRIOR_ART_COLLECTOR } from './brightdata'
import { embed } from '../../llm'
import { PRIOR_ART } from './priorArt'
import { WING_WEIGHT, type Ctx, type OperatorResult } from '../../types'

vi.mock('./brightdata', () => ({
  triggerCollector: vi.fn(),
  healCollector: vi.fn(),
  CORROBORATE_COLLECTOR: 'c_mt12stqk2d78cqkmn2',
  PRIOR_ART_COLLECTOR: 'c_mt12spi4173gff7wai',
}))
vi.mock('../../llm', () => ({ chatJson: vi.fn(), embed: vi.fn() }))

const mockTrigger = vi.mocked(triggerCollector)
const mockHeal = vi.mocked(healCollector)
const mockEmbed = vi.mocked(embed)

type Quote = {
  quote_text: string
  attributed_to: string
  source_note?: string
  section_heading?: string
}

/**
 * The real PRIOR-ART shape: one row per page, quotations nested inside it. Verified
 * 2026-08-20 against the Technology page, 149 quotations under one row.
 */
const wikiPage = (topic: string, quotes: Quote[]) => [
  {
    input: { url: `https://en.wikiquote.org/wiki/${topic}` },
    product_page_url: `https://en.wikiquote.org/wiki/${topic}`,
    quotations: quotes.map(q => ({ source_note: '', section_heading: 'Quotes', ...q })),
  },
]

const cleanPage = (topic: string) =>
  wikiPage(topic, [
    { quote_text: 'The machine does not isolate man from nature.', attributed_to: 'Antoine de Saint-Exupery', source_note: 'Wind, Sand and Stars (1939)' },
    { quote_text: 'Any sufficiently advanced technology is indistinguishable from magic.', attributed_to: 'Arthur C. Clarke', source_note: 'Profiles of the Future (1962)' },
    { quote_text: 'We shape our tools and thereafter our tools shape us.', attributed_to: 'John Culkin', source_note: 'The Saturday Review (1967)' },
  ])

/** Filled on every row and the same on every row: the production mis-binding. */
const misBoundPage = (topic: string) =>
  wikiPage(topic, [
    { quote_text: 'First quote.', attributed_to: 'Isaac Asimov' },
    { quote_text: 'Second quote.', attributed_to: 'Isaac Asimov' },
    { quote_text: 'Third quote.', attributed_to: 'Isaac Asimov' },
  ])

const claimResult = (claim: string, subject: string): OperatorResult => ({
  id: 'CLAIM-EX',
  ops: 1,
  readings: { claim, checkable: 'yes', subject },
})

const ctxWithClaim = (claim: string, subject: string): Ctx => ({
  opinion: 'whatever the person typed',
  batchId: 'b1',
  results: new Map([['CLAIM-EX', claimResult(claim, subject)]]),
})

/** Unit vectors, so cosine against the claim is exactly the number the test names. */
const vectors = (...cosines: number[]) => [
  [1, 0],
  ...cosines.map(c => [c, Math.sqrt(Math.max(0, 1 - c * c))]),
]

beforeEach(() => {
  mockTrigger.mockReset()
  mockHeal.mockReset()
  mockEmbed.mockReset()
  mockHeal.mockResolvedValue('- .quote > cite\n+ .quotation-cite')
  mockEmbed.mockResolvedValue(vectors(0.2, 0.5, 0.1))
})

describe('PRIOR_ART', () => {
  it('declares the shape the plan and the executor expect', () => {
    expect(PRIOR_ART.id).toBe('PRIOR-ART')
    expect(PRIOR_ART.wing).toBe('field')
    expect(PRIOR_ART.needs).toEqual(['CLAIM-EX'])
    expect(PRIOR_ART.costUnits).toBe(20)
    expect(PRIOR_ART.estMs).toBe(120_000)
    expect(PRIOR_ART.touches).toEqual(['primitives.count'])
  })

  it('flattens the nested page row into one row per quotation before validating', async () => {
    mockTrigger.mockResolvedValue(cleanPage('Technology'))

    const r = await PRIOR_ART.run(ctxWithClaim('Tools change the people who use them.', 'tools'))

    // One page row in, three quotations counted out, and no heal needed.
    expect(mockHeal).not.toHaveBeenCalled()
    expect(r.readings.quotationsRead).toBe(3)
  })

  it('scrapes a wikiquote topic and proves any repair on a different topic', async () => {
    mockTrigger.mockResolvedValueOnce(misBoundPage('Technology')).mockResolvedValue(cleanPage('Science'))

    await PRIOR_ART.run(ctxWithClaim('Tools change the people who use them.', 'tools'))

    const calls = mockTrigger.mock.calls
    expect(calls[0][0]).toBe(PRIOR_ART_COLLECTOR)
    expect(calls).toHaveLength(3)
    expect(calls[0][1].url).toMatch(/^https:\/\/en\.wikiquote\.org\/wiki\/\w+$/)
    expect(calls[1][1]).toEqual(calls[0][1])
    expect(calls[2][1].url).not.toBe(calls[0][1].url)
    expect(calls[2][1].url).toMatch(/^https:\/\/en\.wikiquote\.org\/wiki\/\w+$/)
  })

  it('routes the same claim to the same topic every time', async () => {
    mockTrigger.mockResolvedValue(cleanPage('Technology'))

    await PRIOR_ART.run(ctxWithClaim('Tools change the people who use them.', 'tools'))
    await PRIOR_ART.run(ctxWithClaim('Tools change the people who use them.', 'tools'))

    expect(mockTrigger.mock.calls[0][1]).toEqual(mockTrigger.mock.calls[1][1])
  })

  it('fails the gate when attributed_to is identical on every quotation, and heals once', async () => {
    mockTrigger.mockResolvedValueOnce(misBoundPage('Technology')).mockResolvedValue(cleanPage('Science'))

    const r = await PRIOR_ART.run(ctxWithClaim('Tools change the people who use them.', 'tools'))

    expect(mockHeal).toHaveBeenCalledTimes(1)
    expect(mockHeal.mock.calls[0][1]).toMatch(/attributed_to/)
    expect(mockHeal.mock.calls[0][1]).toMatch(/identical/)
    expect(r.readings.repaired).toBe('yes')
  })

  it('calls a human instead of reporting repaired when the verify topic is still mis-bound', async () => {
    // The 2026-08-20 incident: the heal reported success and production had not changed.
    mockTrigger
      .mockResolvedValueOnce(misBoundPage('Technology'))
      .mockResolvedValueOnce(cleanPage('Technology'))
      .mockResolvedValueOnce(misBoundPage('Science'))

    await expect(
      PRIOR_ART.run(ctxWithClaim('Tools change the people who use them.', 'tools')),
    ).rejects.toThrow(/did not generalise/)
    expect(mockTrigger).toHaveBeenCalledTimes(3)
  })

  it('reports originality as one minus the closest cosine match', async () => {
    mockTrigger.mockResolvedValue(cleanPage('Technology'))
    mockEmbed.mockResolvedValue(vectors(0.2, 0.6, 0.1))

    const r = await PRIOR_ART.run(ctxWithClaim('Tools change the people who use them.', 'tools'))

    expect(r.readings.originality).toBeCloseTo(0.4, 6)
  })

  it('names the closest quotation as the source, with the year off its source note', async () => {
    mockTrigger.mockResolvedValue(cleanPage('Technology'))
    mockEmbed.mockResolvedValue(vectors(0.2, 0.9, 0.1))

    const r = await PRIOR_ART.run(ctxWithClaim('Tools change the people who use them.', 'tools'))

    expect(r.readings.closestSource).toBe('Arthur C. Clarke')
    expect(r.readings.closestDate).toBe('1962')
    expect(r.evidence).toHaveLength(1)
    expect(r.evidence![0].snippet).toMatch(/indistinguishable from magic/)
    expect(Number.isNaN(Date.parse(r.evidence![0].retrievedAt))).toBe(false)
  })

  it('reports an unknown date rather than inventing one when the source note has no year', async () => {
    mockTrigger.mockResolvedValue(
      wikiPage('Technology', [
        { quote_text: 'One.', attributed_to: 'A Name', source_note: 'no year here' },
        { quote_text: 'Two.', attributed_to: 'Another Name', source_note: '' },
      ]),
    )
    mockEmbed.mockResolvedValue(vectors(0.9, 0.1))

    const r = await PRIOR_ART.run(ctxWithClaim('Tools change the people who use them.', 'tools'))

    expect(r.readings.closestDate).toBe('unknown')
  })

  it('gives an original take more primitives than a rehash', async () => {
    mockTrigger.mockResolvedValue(cleanPage('Technology'))

    mockEmbed.mockResolvedValue(vectors(0.05, 0.05, 0.05))
    const original = await PRIOR_ART.run(ctxWithClaim('A take nobody has had.', 'take'))

    mockEmbed.mockResolvedValue(vectors(0.99, 0.2, 0.1))
    const rehash = await PRIOR_ART.run(ctxWithClaim('A take nobody has had.', 'take'))

    expect(original.contributions![0].path).toBe('primitives.count')
    expect(original.contributions![0].value as number).toBeGreaterThan(
      rehash.contributions![0].value as number,
    )
  })

  it('claims primitives.count at the field weight scaled by the plan factor', async () => {
    mockTrigger.mockResolvedValue(cleanPage('Technology'))

    const r = await PRIOR_ART.run(ctxWithClaim('Tools change the people who use them.', 'tools'))

    expect(r.contributions).toHaveLength(1)
    expect(r.contributions![0].weight).toBeCloseTo(WING_WEIGHT.field * 0.8, 6)
    expect(Number.isInteger(r.contributions![0].value as number)).toBe(true)
  })

  it('embeds the claim once alongside every candidate quotation', async () => {
    mockTrigger.mockResolvedValue(cleanPage('Technology'))

    await PRIOR_ART.run(ctxWithClaim('Tools change the people who use them.', 'tools'))

    expect(mockEmbed).toHaveBeenCalledTimes(1)
    const texts = mockEmbed.mock.calls[0][0]
    expect(texts[0]).toBe('Tools change the people who use them.')
    expect(texts).toHaveLength(4)
    expect(texts[2]).toMatch(/indistinguishable from magic/)
  })

  it('passes a flat row through the flatten hook unchanged, so both collector shapes work', async () => {
    mockTrigger.mockResolvedValue([
      { quote_text: 'One.', attributed_to: 'A Name', section_heading: 'Quotes' },
      { quote_text: 'Two.', attributed_to: 'Another Name', section_heading: 'Quotes' },
    ])
    mockEmbed.mockResolvedValue(vectors(0.3, 0.1))

    const r = await PRIOR_ART.run(ctxWithClaim('Tools change the people who use them.', 'tools'))

    expect(r.readings.quotationsRead).toBe(2)
  })

  it('throws when CLAIM-EX has not run, rather than scraping for a blank claim', async () => {
    const bare: Ctx = { opinion: 'x', batchId: 'b', results: new Map() }
    await expect(PRIOR_ART.run(bare)).rejects.toThrow(/CLAIM-EX/)
    expect(mockTrigger).not.toHaveBeenCalled()
  })
})
