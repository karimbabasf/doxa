import { describe, it, expect, vi, beforeEach } from 'vitest'
import { triggerCollector, healCollector, CORROBORATE_COLLECTOR } from './brightdata'
import { chatJson } from '../../llm'
import { checkRows, fetchWithRepair } from './schema'
import { CORROBORATE } from './corroborate'
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
const mockChat = vi.mocked(chatJson)

const FIELDS = ['title', 'topic_url']
const OPTS = { mustVary: ['title', 'topic_url'] }
const INPUT = { url: 'https://tildes.net/~tech' }
const VERIFY = { url: 'https://tildes.net/~science' }

const rowsFrom = (tag: string, n = 3) =>
  Array.from({ length: n }, (_, i) => ({ title: `${tag} title ${i}`, topic_url: `https://x/${tag}/${i}` }))

/** Present, filled, and the same on every row: the 2026-08-20 mis-bound selector. */
const misBound = (n = 3) =>
  Array.from({ length: n }, () => ({ title: 'Isaac Asimov', topic_url: 'https://x/one' }))

const missingField = (n = 3) => Array.from({ length: n }, (_, i) => ({ title: `t${i}` }))

beforeEach(() => {
  mockTrigger.mockReset()
  mockHeal.mockReset()
  mockChat.mockReset()
  mockHeal.mockResolvedValue('- .topic > h1\n+ .topic-title')
})

describe('fetchWithRepair', () => {
  it('costs one scrape and never touches verifyInput when the first scrape is clean', async () => {
    mockTrigger.mockResolvedValueOnce(rowsFrom('input'))

    const out = await fetchWithRepair('c_1', INPUT, VERIFY, FIELDS, OPTS)

    expect(out.repaired).toBe(false)
    expect(mockHeal).not.toHaveBeenCalled()
    expect(mockTrigger).toHaveBeenCalledTimes(1)
    expect(mockTrigger).toHaveBeenCalledWith('c_1', INPUT)
    for (const call of mockTrigger.mock.calls) expect(call[1]).not.toEqual(VERIFY)
  })

  it('heals exactly once and passes the schema failure reason verbatim', async () => {
    const bad = missingField()
    mockTrigger
      .mockResolvedValueOnce(bad)
      .mockResolvedValueOnce(rowsFrom('input'))
      .mockResolvedValueOnce(rowsFrom('verify'))

    await fetchWithRepair('c_1', INPUT, VERIFY, FIELDS, OPTS)

    const gate = checkRows(bad, FIELDS, OPTS)
    expect(gate.ok).toBe(false)
    expect(mockHeal).toHaveBeenCalledTimes(1)
    expect(mockHeal).toHaveBeenCalledWith('c_1', gate.ok ? '' : gate.reason)
  })

  it('names the specific missing field in the why, not a generic message', async () => {
    mockTrigger
      .mockResolvedValueOnce(missingField())
      .mockResolvedValueOnce(rowsFrom('input'))
      .mockResolvedValueOnce(rowsFrom('verify'))

    await fetchWithRepair('c_1', INPUT, VERIFY, FIELDS, OPTS)

    expect(mockHeal.mock.calls[0][1]).toMatch(/topic_url/)
  })

  it('throws after one heal when the re-scrape still fails, and never tries a third pass', async () => {
    mockTrigger.mockResolvedValue(missingField())

    await expect(fetchWithRepair('c_1', INPUT, VERIFY, FIELDS, OPTS)).rejects.toThrow(/human/i)

    expect(mockHeal).toHaveBeenCalledTimes(1)
    expect(mockTrigger).toHaveBeenCalledTimes(2)
  })

  it('scrapes input then verifyInput, in that order, on the repair path', async () => {
    mockTrigger
      .mockResolvedValueOnce(missingField())
      .mockResolvedValueOnce(rowsFrom('input'))
      .mockResolvedValueOnce(rowsFrom('verify'))

    await fetchWithRepair('c_1', INPUT, VERIFY, FIELDS, OPTS)

    expect(mockTrigger.mock.calls.map(c => c[1])).toEqual([INPUT, INPUT, VERIFY])
  })

  it('throws naming the verify input when the original passes after a heal but the verify does not', async () => {
    mockTrigger
      .mockResolvedValueOnce(missingField())
      .mockResolvedValueOnce(rowsFrom('input'))
      .mockResolvedValueOnce(misBound())

    const call = fetchWithRepair('c_1', INPUT, VERIFY, FIELDS, OPTS)

    await expect(call).rejects.toThrow(/tildes\.net\/~science/)
    await expect(call).rejects.toThrow(/did not generalise/)
    expect(mockTrigger).toHaveBeenCalledTimes(3)
  })

  it('reports repaired only when both post-heal scrapes pass', async () => {
    mockTrigger
      .mockResolvedValueOnce(missingField())
      .mockResolvedValueOnce(rowsFrom('input'))
      .mockResolvedValueOnce(rowsFrom('verify'))

    const out = await fetchWithRepair('c_1', INPUT, VERIFY, FIELDS, OPTS)

    expect(out.repaired).toBe(true)
    expect(out.healDiff).toContain('topic-title')
  })

  it('returns the rows from input, never the rows from verifyInput', async () => {
    mockTrigger
      .mockResolvedValueOnce(missingField())
      .mockResolvedValueOnce(rowsFrom('input'))
      .mockResolvedValueOnce(rowsFrom('verify'))

    const out = await fetchWithRepair('c_1', INPUT, VERIFY, FIELDS, OPTS)

    expect(out.rows.every(r => r.title.startsWith('input'))).toBe(true)
    expect(out.rows.some(r => r.title.startsWith('verify'))).toBe(false)
  })

  it('applies mustVary on the first attempt, so a mis-bound scrape triggers a heal', async () => {
    mockTrigger
      .mockResolvedValueOnce(misBound())
      .mockResolvedValueOnce(rowsFrom('input'))
      .mockResolvedValueOnce(rowsFrom('verify'))

    const out = await fetchWithRepair('c_1', INPUT, VERIFY, FIELDS, OPTS)

    expect(mockHeal).toHaveBeenCalledTimes(1)
    expect(mockHeal.mock.calls[0][1]).toMatch(/identical/)
    expect(out.repaired).toBe(true)
  })

  it('applies mustVary on the re-scrape, so a healed but mis-bound collector still fails', async () => {
    mockTrigger
      .mockResolvedValueOnce(missingField())
      .mockResolvedValueOnce(misBound())
      .mockResolvedValueOnce(rowsFrom('verify'))

    await expect(fetchWithRepair('c_1', INPUT, VERIFY, FIELDS, OPTS)).rejects.toThrow(/identical/)
    expect(mockTrigger).toHaveBeenCalledTimes(2)
  })

  it('applies mustVary on the verify scrape, so the proof cannot pass on identical rows', async () => {
    mockTrigger
      .mockResolvedValueOnce(missingField())
      .mockResolvedValueOnce(rowsFrom('input'))
      .mockResolvedValueOnce(misBound())

    await expect(fetchWithRepair('c_1', INPUT, VERIFY, FIELDS, OPTS)).rejects.toThrow(/identical/)
  })

  it('applies the flatten hook on every attempt, including the verify scrape', async () => {
    const nest = (tag: string) => [{ quotations: rowsFrom(tag) }]
    const flatten = (rows: unknown[]) =>
      (rows as { quotations: unknown[] }[]).flatMap(page => page.quotations)

    mockTrigger
      .mockResolvedValueOnce([{ quotations: missingField() }])
      .mockResolvedValueOnce(nest('input'))
      .mockResolvedValueOnce(nest('verify'))

    const out = await fetchWithRepair('c_1', INPUT, VERIFY, FIELDS, { ...OPTS, flatten })

    expect(out.repaired).toBe(true)
    expect(out.rows).toHaveLength(3)
    expect(out.rows[0].title).toContain('input')
  })
})

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

const tildesRows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    title: `Thread ${i}`,
    topic_url: `https://tildes.net/~tech/abc${i}/thread-${i}`,
    group: 'tech',
    posted_at: `2026-08-0${(i % 9) + 1}`,
    comment_count: i * 3,
    product_page_url: 'https://tildes.net/~tech',
    input: { url: 'https://tildes.net/~tech' },
  }))

const labels = (supports: boolean[]) => ({
  labels: supports.map((s, i) => ({ index: i, supports: s })),
})

describe('CORROBORATE', () => {
  it('declares the shape the plan and the executor expect', () => {
    expect(CORROBORATE.id).toBe('CORROBORATE')
    expect(CORROBORATE.wing).toBe('field')
    expect(CORROBORATE.needs).toEqual(['CLAIM-EX'])
    expect(CORROBORATE.costUnits).toBe(20)
    expect(CORROBORATE.estMs).toBe(9000)
    expect(CORROBORATE.touches).toEqual(['palette.ground'])
  })

  it('scrapes the pinned collector with a tildes group url and a different group to verify', async () => {
    mockTrigger.mockResolvedValue(tildesRows(4))
    mockChat.mockResolvedValue(labels([true, true, true, false]))

    await CORROBORATE.run(ctxWithClaim('Rust compiles slower than Go.', 'Rust'))

    expect(mockTrigger).toHaveBeenCalledTimes(1)
    const [collectorId, input] = mockTrigger.mock.calls[0]
    expect(collectorId).toBe(CORROBORATE_COLLECTOR)
    expect(input.url).toMatch(/^https:\/\/tildes\.net\/~[a-z]+$/)
  })

  it('picks a verify group that is never the group it scraped', async () => {
    mockTrigger.mockResolvedValueOnce(missingField()).mockResolvedValue(tildesRows(3))
    mockChat.mockResolvedValue(labels([true, true, false]))

    await CORROBORATE.run(ctxWithClaim('Index funds beat stock picking.', 'index funds'))

    const inputs = mockTrigger.mock.calls.map(c => c[1].url)
    expect(inputs).toHaveLength(3)
    expect(inputs[0]).toBe(inputs[1])
    expect(inputs[2]).not.toBe(inputs[0])
    expect(inputs[2]).toMatch(/^https:\/\/tildes\.net\/~[a-z]+$/)
  })

  it('routes the same claim to the same group every time', async () => {
    mockTrigger.mockResolvedValue(tildesRows(2))
    mockChat.mockResolvedValue(labels([true, false]))

    await CORROBORATE.run(ctxWithClaim('Rust compiles slower than Go.', 'Rust'))
    await CORROBORATE.run(ctxWithClaim('Rust compiles slower than Go.', 'Rust'))

    expect(mockTrigger.mock.calls[0][1]).toEqual(mockTrigger.mock.calls[1][1])
  })

  it('gates on title and topic_url varying, so a mis-bound scrape heals instead of shipping', async () => {
    // Every declared field present and filled, title and topic_url identical on every row.
    const misBoundTildes = tildesRows(5).map(row => ({
      ...row,
      title: 'Isaac Asimov',
      topic_url: 'https://tildes.net/~tech/one',
    }))
    mockTrigger.mockResolvedValueOnce(misBoundTildes).mockResolvedValue(tildesRows(3))
    mockChat.mockResolvedValue(labels([true, true, false]))

    const r = await CORROBORATE.run(ctxWithClaim('Solar is cheaper than gas now.', 'solar'))

    expect(mockHeal).toHaveBeenCalledTimes(1)
    expect(mockHeal.mock.calls[0][1]).toMatch(/identical/)
    expect(r.readings.repaired).toBe('yes')
    expect(r.notes?.join(' ')).toContain('topic-title')
  })

  it('reports repaired as the word no on the happy path', async () => {
    mockTrigger.mockResolvedValue(tildesRows(3))
    mockChat.mockResolvedValue(labels([true, true, false]))

    const r = await CORROBORATE.run(ctxWithClaim('Solar is cheaper than gas now.', 'solar'))

    expect(r.readings.repaired).toBe('no')
    expect(typeof r.readings.repaired).toBe('string')
  })

  it('scores corroboration as supporting minus contradicting over total', async () => {
    mockTrigger.mockResolvedValue(tildesRows(4))
    mockChat.mockResolvedValue(labels([true, true, true, false]))

    const r = await CORROBORATE.run(ctxWithClaim('Solar is cheaper than gas now.', 'solar'))

    expect(r.readings.corroborationScore).toBeCloseTo(0.5, 6)
    expect(r.readings.sourcesChecked).toBe(4)
  })

  it('returns one evidence row per labelled source, carrying the url and the verdict', async () => {
    mockTrigger.mockResolvedValue(tildesRows(3))
    mockChat.mockResolvedValue(labels([true, false, true]))

    const r = await CORROBORATE.run(ctxWithClaim('Solar is cheaper than gas now.', 'solar'))

    expect(r.evidence).toHaveLength(3)
    const first = r.evidence![0]
    expect(first.url).toBe('https://tildes.net/~tech/abc0/thread-0')
    expect(first.snippet).toBe('Thread 0')
    expect(first.source).toMatch(/tildes/i)
    expect(Number.isNaN(Date.parse(first.retrievedAt))).toBe(false)
    expect(r.evidence!.map(e => e.supports)).toEqual([true, false, true])
  })

  it('claims palette.ground at the field weight scaled by how decisive the sweep was', async () => {
    mockTrigger.mockResolvedValue(tildesRows(4))
    mockChat.mockResolvedValue(labels([true, true, true, true]))

    const r = await CORROBORATE.run(ctxWithClaim('Solar is cheaper than gas now.', 'solar'))

    expect(r.contributions).toHaveLength(1)
    const c = r.contributions![0]
    expect(c.path).toBe('palette.ground')
    expect(c.weight).toBeCloseTo(WING_WEIGHT.field, 6)
    expect(c.value).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('never claims palette.ground at zero weight, because the merge throws on that', async () => {
    // Two supporting and two contradicting is a real result, not a missing one.
    mockTrigger.mockResolvedValue(tildesRows(4))
    mockChat.mockResolvedValue(labels([true, true, false, false]))

    const r = await CORROBORATE.run(ctxWithClaim('Solar is cheaper than gas now.', 'solar'))

    expect(r.readings.corroborationScore).toBeCloseTo(0, 6)
    expect(r.contributions![0].weight).toBeGreaterThan(0)
  })

  it('gives a supported claim a lighter ground than a contradicted one', async () => {
    const lightness = (hex: string) =>
      parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16)

    mockTrigger.mockResolvedValue(tildesRows(3))
    mockChat.mockResolvedValue(labels([true, true, true]))
    const supported = await CORROBORATE.run(ctxWithClaim('Solar is cheaper than gas.', 'solar'))

    mockChat.mockResolvedValue(labels([false, false, false]))
    const contradicted = await CORROBORATE.run(ctxWithClaim('Solar is cheaper than gas.', 'solar'))

    expect(lightness(supported.contributions![0].value as string)).toBeGreaterThan(
      lightness(contradicted.contributions![0].value as string),
    )
  })

  it('sends the claim to the labelling call exactly once', async () => {
    mockTrigger.mockResolvedValue(tildesRows(3))
    mockChat.mockResolvedValue(labels([true, false, true]))

    await CORROBORATE.run(ctxWithClaim('Solar is cheaper than gas now.', 'solar'))

    expect(mockChat).toHaveBeenCalledTimes(1)
    const opts = mockChat.mock.calls[0][0] as { system: string; user: string }
    expect(opts.user).toContain('Solar is cheaper than gas now.')
    expect(opts.user).toContain('Thread 0')
  })

  it('throws when CLAIM-EX has not run, rather than scraping for a blank claim', async () => {
    const bare: Ctx = { opinion: 'x', batchId: 'b', results: new Map() }
    await expect(CORROBORATE.run(bare)).rejects.toThrow(/CLAIM-EX/)
    expect(mockTrigger).not.toHaveBeenCalled()
  })
})
