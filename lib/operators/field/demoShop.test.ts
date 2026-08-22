import { describe, it, expect, vi, beforeEach } from 'vitest'
import { triggerCollector, healCollector } from './brightdata'
import { DEMO_SHOP, contrastFor, flattenProducts } from './demoShop'
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

/**
 * The collector's real shape, verified against c_mt4lryh31kh6vr7brh on 2026-08-22: one row
 * per page with the products nested, price as an object, stock as a number.
 */
const page = (url: string, products: unknown[]) => [
  { products, product_page_url: url, input: { url } },
]

const money = (value: number) => ({ value, currency: 'USD', symbol: '$' })

/** Set `a` as the page really serves it: six products, prices $2.15 to $29.00. */
const setA = () =>
  page('https://tunnel.example/demo/shop/a', [
    { name: 'Kraft Mailer 6 x 9', price: money(4.25), sku: 'WS-1041', stock: 184 },
    { name: 'Double Wall Carton 18 x 18 x 16', price: money(6.8), sku: 'WS-1042', stock: 62 },
    { name: 'Wardrobe Box with Bar', price: money(14.5), sku: 'WS-1043', stock: 27 },
    { name: 'Small Moving Box 16 x 12 x 12', price: money(2.15), sku: 'WS-1044', stock: 410 },
    { name: 'Dish Pack Carton with Dividers', price: money(11.95), sku: 'WS-1045', stock: 38 },
    { name: 'Flat Screen Television Box', price: money(29), sku: 'WS-1046', stock: 15 },
  ])

/** Set `b`, different SKUs, which is what makes it a proof rather than a repeat. */
const setB = () =>
  page('https://tunnel.example/demo/shop/b', [
    { name: 'Clear Packing Tape 2 in x 55 yd', price: money(3.4), sku: 'WS-2071', stock: 520 },
    { name: 'Fragile Warning Tape', price: money(5.1), sku: 'WS-2072', stock: 146 },
    { name: 'Tape Gun with Side Loader', price: money(18.75), sku: 'WS-2073', stock: 44 },
  ])

/** The break: the price class is renamed, so the collector returns products with no price. */
const broken = () =>
  page(
    'https://tunnel.example/demo/shop/a',
    (setA()[0].products as Record<string, unknown>[]).map(({ name, sku, stock }) => ({
      name,
      sku,
      stock,
    })),
  )

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
    mockTrigger.mockResolvedValueOnce(
      page('https://tunnel.example/demo/shop/a', [
        { name: 'Kraft Mailer 6 x 9', price: money(4.25), sku: 'WS-1041', stock: 184 },
        { name: 'Wardrobe Box with Bar', price: money(14.5), sku: 'WS-1043', stock: 0 },
      ]),
    )

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
    const misBound = () =>
      page(
        'https://tunnel.example/demo/shop/a',
        (setA()[0].products as Record<string, unknown>[]).map(row => ({
          ...row,
          name: 'Kraft Mailer 6 x 9',
        })),
      )
    mockTrigger.mockResolvedValueOnce(misBound()).mockResolvedValueOnce(misBound())

    await expect(DEMO_SHOP.run(ctx)).rejects.toThrow(/human/)
    expect(mockHeal.mock.calls[0][1]).toMatch(/name/)
  })
})

describe('flattenProducts', () => {
  it('turns one page row into one row per product', () => {
    const flat = flattenProducts(setA()) as Record<string, string>[]

    expect(flat).toHaveLength(6)
    expect(flat[0].name).toBe('Kraft Mailer 6 x 9')
    expect(flat[0].sku).toBe('WS-1041')
  })

  it('flattens the price object to the text a human reads', () => {
    const flat = flattenProducts(setA()) as Record<string, string>[]

    expect(flat[0].price).toBe('$4.25')
    expect(flat[5].price).toBe('$29')
  })

  it('leaves an absent price absent, so the gate names the missing field', () => {
    const flat = flattenProducts(broken()) as Record<string, string>[]

    expect(flat).toHaveLength(6)
    expect('price' in flat[0]).toBe(false)
  })

  it('passes an already flat row through, so a rebuilt collector still works', () => {
    const flat = flattenProducts([
      { name: 'Kraft Mailer 6 x 9', price: '$4.25', sku: 'WS-1041', stock: '184' },
    ]) as Record<string, string>[]

    expect(flat).toHaveLength(1)
    expect(flat[0].price).toBe('$4.25')
  })
})
