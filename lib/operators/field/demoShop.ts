import { register } from '../registry'
import { DEMO_SHOP_COLLECTOR, demoShopUrl } from './brightdata'
import { fetchWithRepair, type Row } from './schema'
import { WING_WEIGHT, type Evidence, type Operator } from '../../types'

/**
 * The controlled instrument.
 *
 * CORROBORATE and PRIOR-ART point at pages the open web owns, so the day they break is
 * not ours to pick. This one points at a shop page this app serves, which is the only
 * way to show the repair path working on demand rather than describing it.
 *
 * Nothing about the reading is staged. The collector is a real Bright Data collector,
 * the scrape is a real scrape over a public URL, and every number below is computed from
 * the rows that came back. The one thing we control is when the page changes.
 *
 * It registers only under DOXA_DEMO_SHOP=1. A run that is not the demo has no business
 * spending two minutes and a scrape on a catalogue that has nothing to do with the
 * opinion in front of it.
 *
 * The field names are the collector's real ones. See CLAUDE.md.
 */

/** The collector's real field names. Never invent one: a check the scraper cannot satisfy
 *  produces a failure no heal can fix, because the scraper is right and the check is wrong. */
const FIELDS = ['name', 'price', 'sku', 'stock']

/** A catalogue whose names or SKUs repeat is a mis-bound selector, never a real shop.
 *  `price` and `stock` stay out: two products may legitimately cost the same. */
const MUST_VARY = ['name', 'sku']

/** Read set `a`, prove any repair on set `b`. The sets hold different SKUs, so a heal that
 *  only memorised set `a` cannot pass the proof. */
const READ_SET = 'a'
const VERIFY_SET = 'b'

/** One primitive per product is too sparse to read across a room, so each product brings
 *  a small cluster instead. Six products land at 72, inside the renderer's 0 to 512. */
const PRIMITIVES_PER_PRODUCT = 12

/** A real reading of a flat catalogue still claims its path. mergeContributions throws on
 *  a path claimed only at zero weight, and that loses the specimen. */
const MIN_WEIGHT = 0.05

/**
 * The collector returns price as `{ value, currency, symbol }`, not as the text on the
 * page. Flattened to the string a human reads, so the certificate quotes "$14.50" and
 * `money` below still parses it. An absent price is left absent rather than filled with
 * an empty string, so the gate names the missing field instead of the empty one.
 */
function priceCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    const box = value as { value?: unknown; symbol?: unknown }
    if (box.value === null || box.value === undefined) return ''
    return `${typeof box.symbol === 'string' ? box.symbol : ''}${box.value}`
  }
  return String(value)
}

/**
 * This collector returns one row per page with the products nested under it, the same
 * convention PRIOR-ART uses and the opposite of CORROBORATE's. A row that already looks
 * flat passes through untouched, so the operator survives a collector rebuilt the other
 * way. The hook runs on every attempt, the verify scrape included, so a nested collector
 * cannot skip the gate on the one scrape that proves a repair held.
 */
export function flattenProducts(rows: unknown[]): unknown[] {
  const out: unknown[] = []
  for (const raw of rows) {
    if (raw === null || typeof raw !== 'object') {
      out.push(raw)
      continue
    }
    const page = raw as Record<string, unknown>
    if (!Array.isArray(page.products)) {
      out.push(raw)
      continue
    }
    for (const item of page.products) {
      if (item === null || typeof item !== 'object') {
        out.push(item)
        continue
      }
      const row = { ...(item as Record<string, unknown>) }
      if ('price' in row) row.price = priceCell(row.price)
      out.push(row)
    }
  }
  return out
}

/** "$14.50" -> 14.5. A cell the collector could not fill reads as NaN and gets dropped. */
function money(cell: string): number {
  const n = Number(String(cell).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : NaN
}

/** "184" -> 184. Anything unparseable counts as no stock rather than as a guess. */
function counted(cell: string): number {
  const n = Number(String(cell).replace(/[^0-9]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** A catalogue running from cheap to dear is a high contrast one. Flat pricing is low.
 *  Log scaled, because a shop with a 40x spread is not 40 times more interesting. */
export function contrastFor(spread: number): number {
  if (!Number.isFinite(spread) || spread <= 1) return 1
  return Math.min(8, 1 + Math.log2(spread))
}

export const DEMO_SHOP: Operator = {
  id: 'DEMO-SHOP',
  name: 'Supply catalogue check',
  wing: 'field',
  blurb:
    'Scrapes a live supply catalogue and reads its price spread and stock depth. Pick it when the opinion is about prices, cost, goods, stock, shortages or supply.',
  needs: [],
  costUnits: 8,
  estMs: 50_000,
  estOps: 40,
  touches: ['primitives.count', 'dither.contrast'],
  async run() {
    const retrievedAt = new Date().toISOString()

    const scrape = await fetchWithRepair(
      DEMO_SHOP_COLLECTOR,
      { url: demoShopUrl(READ_SET) },
      { url: demoShopUrl(VERIFY_SET) },
      FIELDS,
      // Six products fit inside the synchronous endpoint's cap easily, so this scrape
      // answers in seconds instead of dropping into batch polling. It is the difference
      // between a repair beat of about a minute and one of four to six.
      { mustVary: MUST_VARY, sync: true, flatten: flattenProducts },
    )

    const rows: Row[] = scrape.rows
    const prices = rows.map(row => money(row.price)).filter(n => Number.isFinite(n))
    const low = prices.length ? Math.min(...prices) : 0
    const high = prices.length ? Math.max(...prices) : 0
    const spread = low > 0 ? high / low : 1
    const stockTotal = rows.reduce((sum, row) => sum + counted(row.stock), 0)

    const evidence: Evidence[] = rows.map(row => ({
      source: `Wickham Supply Co. set ${READ_SET}`,
      url: demoShopUrl(READ_SET),
      snippet: `${row.name}, ${row.price}, ${row.stock} in stock, ${row.sku}`,
      retrievedAt,
      // A catalogue has no argument to take a side in, so this reads as "the shop can
      // actually supply it". A zero stock line is a listing, not a supply.
      supports: counted(row.stock) > 0,
    }))

    return {
      id: 'DEMO-SHOP',
      // Every cell read, plus the two aggregates computed over them.
      ops: rows.length * FIELDS.length + 2,
      readings: {
        productsRead: rows.length,
        lowestPrice: low,
        highestPrice: high,
        priceSpread: Number(spread.toFixed(2)),
        stockTotal,
        // readings holds scalars only, so the boolean lands as a word.
        repaired: scrape.repaired ? 'yes' : 'no',
      },
      evidence,
      contributions: [
        {
          path: 'primitives.count',
          value: rows.length * PRIMITIVES_PER_PRODUCT,
          weight: Math.max(MIN_WEIGHT, WING_WEIGHT.field),
        },
        {
          path: 'dither.contrast',
          value: contrastFor(spread),
          // A flat catalogue argues quietly for its own flatness rather than loudly.
          weight: Math.max(
            MIN_WEIGHT,
            WING_WEIGHT.field * Math.min(1, Math.log2(Math.max(1, spread)) / 4),
          ),
        },
      ],
      notes: scrape.healDiff
        ? [`collector healed and re-proved on set ${VERIFY_SET}`, scrape.healDiff]
        : undefined,
    }
  },
}

/**
 * Opt in, never on by default. The demo needs this operator in the planner's catalogue;
 * every other run needs it absent.
 */
if (process.env.DOXA_DEMO_SHOP === '1') register(DEMO_SHOP)
