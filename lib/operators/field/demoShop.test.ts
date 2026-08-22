import { describe, it, expect, vi, beforeEach } from 'vitest'
import { triggerCollector, healCollector } from './brightdata'
import { DEMO_SHOP, contrastFor } from './demoShop'
import { WING_WEIGHT, type Ctx } from '../../types'

vi.mock('./brightdata', () => ({
  triggerCollector: vi.fn(),
  healCollector: vi.fn(),
  DEMO_SHOP_COLLECTOR: 'c_demo',
  CORROBORATE_COLLECTOR: 'c_corroborate',
  PRIOR_ART_COLLECTOR: 'c_priorart',
  demoShopUrl: (set: string) => `https://tunnel.example/demo/shop/${set}`,
}))

const mockTrigger = vi.mocked(triggerCollector)
const mockHeal = vi.mocked(healCollector)

const ctx: Ctx = { opinion: 'packing supplies cost too much', batchId: 'b1', results: new Map() }

/** Set `a` as the page really serves it: six products, prices $2.15 to $29.00. */
const setA = () => [
  { name: 'Kraft Mailer 6 x 9', price: '$4.25', sku: 'WS-1041', stock: '184' },
  { name: 'Double Wall Carton 18 x 18 x 16', price: '$6.80', sku: 'WS-1042', stock: '62' },
  { name: 'Wardrobe Box with Bar', price: '$14.50', sku: 'WS-1043', stock: '27' },
  { name: 'Small Moving Box 16 x 12 x 12', price: '$2.15', sku: 'WS-1044', stock: '410' },
  { name: 'Dish Pack Carton with Dividers', price: '$11.95', sku: 'WS-1045', stock: '38' },
  { name: 'Flat Screen Television Box', price: '$29.00', sku: 'WS-1046', stock: '15' },
]

/** Set `b`, different SKUs, which is what makes it a proof rather than a repeat. */
const setB = () => [
  { name: 'Clear Packing Tape 2 in x 55 yd', price: '$3.40', sku: 'WS-2071', stock: '520' },
  { name: 'Fragile Warning Tape', price: '$5.10', sku: 'WS-2072', stock: '146' },
  { name: 'Tape Gun with Side Loader', price: '$18.75', sku: 'WS-2073', stock: '44' },
]

/** The break: the price class is renamed, so the collector returns rows with no price. */
const broken = () => setA().map(({ name, sku, stock }) => ({ name, sku, stock }))

beforeEach(() => {
  mockTrigger.mockReset()
  mockHeal.mockReset()
  mockHeal.mockResolvedValue('- dd.price\n+ dd.cost')
})

describe('contrastFor', () => {
  it('reads a flat catalogue as the floor', () => {
    expect(contrastFor(1)).toBe(1)
    expect(contrastFor(0.5)).toBe(1)
  })

  it('grows with the spread but never past the renderer ceiling', () => {
    expect(contrastFor(2)).toBeCloseTo(2, 5)
    expect(contrastFor(4)).toBeCloseTo(3, 5)
    expect(contrastFor(1e9)).toBeLessThanOrEqual(8)
  })

  it('refuses a nonsense spread rather than emitting NaN into the specimen', () => {
    expect(contrastFor(NaN)).toBe(1)
    expect(contrastFor(Infinity)).toBeLessThanOrEqual(8)
  })
})

describe('DEMO-SHOP contract', () => {
  it('is a field operator that depends on nothing', () => {
    expect(DEMO_SHOP.wing).toBe('field')
    expect(DEMO_SHOP.needs).toEqual([])
  })

  it('only ever writes the two paths it declares', () => {
    expect(DEMO_SHOP.touches).toEqual(['primitives.count', 'dither.contrast'])
  })
})

describe('DEMO-SHOP on a clean scrape', () => {
  it('costs one scrape and never reaches for the verify set', async () => {
    mockTrigger.mockResolvedValueOnce(setA())

    const out = await DEMO_SHOP.run(ctx)

    expect(mockTrigger).toHaveBeenCalledTimes(1)
    expect(mockTrigger).toHaveBeenCalledWith(
      'c_demo',
      { url: 'https://tunnel.example/demo/shop/a' },
      { sync: true },
    )
    expect(mockHeal).not.toHaveBeenCalled()
    expect(out.readings.repaired).toBe('no')
  })

  it('reads the real numbers off the rows', async () => {
    mockTrigger.mockResolvedValueOnce(setA())

    const out = await DEMO_SHOP.run(ctx)

    expect(out.readings.productsRead).toBe(6)
    expect(out.readings.lowestPrice).toBe(2.15)
    expect(out.readings.highestPrice).toBe(29)
    expect(out.readings.priceSpread).toBe(13.49)
    expect(out.readings.stockTotal).toBe(184 + 62 + 27 + 410 + 38 + 15)
  })

  it('counts every cell it read, not every row', async () => {
    mockTrigger.mockResolvedValueOnce(setA())

    const out = await DEMO_SHOP.run(ctx)

    expect(out.ops).toBe(6 * 4 + 2)
  })

  it('claims one primitive cluster per product', async () => {
    mockTrigger.mockResolvedValueOnce(setA())

    const out = await DEMO_SHOP.run(ctx)
    const count = out.contributions?.find(c => c.path === 'primitives.count')

    expect(count?.value).toBe(72)
    expect(count?.weight).toBe(WING_WEIGHT.field)
  })

  it('claims contrast from the price spread', async () => {
    mockTrigger.mockResolvedValueOnce(setA())

    const out = await DEMO_SHOP.run(ctx)
    const contrast = out.contributions?.find(c => c.path === 'dither.contrast')

    expect(contrast?.value).toBeCloseTo(contrastFor(29 / 2.15), 5)
    expect(contrast?.weight).toBeGreaterThan(0)
  })

  it('marks a zero stock line as something the shop cannot supply', async () => {
    mockTrigger.mockResolvedValueOnce([
      { name: 'Kraft Mailer 6 x 9', price: '$4.25', sku: 'WS-1041', stock: '184' },
      { name: 'Wardrobe Box with Bar', price: '$14.50', sku: 'WS-1043', stock: '0' },
    ])

    const out = await DEMO_SHOP.run(ctx)

    expect(out.evidence?.map(e => e.supports)).toEqual([true, false])
  })
})

describe('DEMO-SHOP when the page breaks', () => {
  it('heals once, re-scrapes, and proves the fix on the untouched set', async () => {
    mockTrigger
      .mockResolvedValueOnce(broken()) // the break: price is gone
      .mockResolvedValueOnce(setA()) // re-scrape after the heal
      .mockResolvedValueOnce(setB()) // the proof, on a set this run has not read

    const out = await DEMO_SHOP.run(ctx)

    expect(mockHeal).toHaveBeenCalledTimes(1)
    expect(mockHeal.mock.calls[0][1]).toMatch(/price/)
    expect(mockTrigger).toHaveBeenNthCalledWith(
      3,
      'c_demo',
      { url: 'https://tunnel.example/demo/shop/b' },
      { sync: true },
    )
    expect(out.readings.repaired).toBe('yes')
    expect(out.notes?.[0]).toMatch(/re-proved on set b/)
  })

  it('refuses to say repaired when the fix does not hold on the untouched set', async () => {
    mockTrigger
      .mockResolvedValueOnce(broken())
      .mockResolvedValueOnce(setA())
      .mockResolvedValueOnce(broken()) // the heal only memorised set a

    await expect(DEMO_SHOP.run(ctx)).rejects.toThrow(/did not generalise/)
  })

  it('calls a human rather than healing a second time', async () => {
    mockTrigger.mockResolvedValueOnce(broken()).mockResolvedValueOnce(broken())

    await expect(DEMO_SHOP.run(ctx)).rejects.toThrow(/human/)
    expect(mockHeal).toHaveBeenCalledTimes(1)
  })

  it('catches a mis-bound name even when every row is filled', async () => {
    const misBound = setA().map(row => ({ ...row, name: 'Kraft Mailer 6 x 9' }))
    mockTrigger.mockResolvedValueOnce(misBound).mockResolvedValueOnce(misBound)

    await expect(DEMO_SHOP.run(ctx)).rejects.toThrow(/human/)
    expect(mockHeal.mock.calls[0][1]).toMatch(/name/)
  })
})
