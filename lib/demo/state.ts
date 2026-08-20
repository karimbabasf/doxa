import Database from 'better-sqlite3'
import type { Database as Db } from 'better-sqlite3'

/**
 * The demo target: one break flag and the catalogue the shop page renders.
 *
 * The flag lives in SQLite rather than in memory because the page and the break route
 * are two request handlers, and because a rehearsal that restores the page has to hold
 * across a restart. It sits in its own table so the run schema in `lib/db.ts` stays the
 * run schema.
 *
 * The break is a renamed class and nothing else. `bdata scraper heal` fixes renamed
 * selectors and does not fix mis-bound fields, so the only break we stage on camera is
 * the kind a healer can actually repair.
 */

export type PriceClass = 'price' | 'cost'

export type DemoBreak = {
  broken: boolean
  changedAt: string
}

/** One product record. The keys are the four fields the demo collector declares. */
export type DemoProduct = {
  name: string
  price: string
  sku: string
  stock: string
}

/**
 * Three sets, each holding different products. `fetchWithRepair` needs an input the run
 * has not scraped for its verify pass, so a spare set is the cheapest way to always have
 * an untouched URL.
 */
export const DEMO_SETS = ['a', 'b', 'c'] as const

export type DemoSet = (typeof DEMO_SETS)[number]

const CATALOGUE: Record<DemoSet, readonly DemoProduct[]> = {
  a: [
    { name: 'Kraft Mailer 6 x 9', price: '$4.25', sku: 'WS-1041', stock: '184' },
    { name: 'Double Wall Carton 18 x 18 x 16', price: '$6.80', sku: 'WS-1042', stock: '62' },
    { name: 'Wardrobe Box with Bar', price: '$14.50', sku: 'WS-1043', stock: '27' },
    { name: 'Small Moving Box 16 x 12 x 12', price: '$2.15', sku: 'WS-1044', stock: '410' },
    { name: 'Dish Pack Carton with Dividers', price: '$11.95', sku: 'WS-1045', stock: '38' },
    { name: 'Flat Screen Television Box', price: '$29.00', sku: 'WS-1046', stock: '15' },
  ],
  b: [
    { name: 'Clear Packing Tape 2 in x 55 yd', price: '$3.40', sku: 'WS-2071', stock: '520' },
    { name: 'Fragile Warning Tape', price: '$5.10', sku: 'WS-2072', stock: '146' },
    { name: 'Tape Gun with Side Loader', price: '$18.75', sku: 'WS-2073', stock: '44' },
    { name: 'Blank Shipping Labels 4 x 6', price: '$21.30', sku: 'WS-2074', stock: '89' },
    { name: 'Room Marker Label Pack', price: '$7.65', sku: 'WS-2075', stock: '212' },
  ],
  c: [
    { name: 'Bubble Cushion Roll 12 in x 175 ft', price: '$32.00', sku: 'WS-3018', stock: '73' },
    { name: 'Unprinted Newsprint 10 lb', price: '$16.40', sku: 'WS-3019', stock: '118' },
    { name: 'Foam Pouches for Glassware', price: '$9.20', sku: 'WS-3020', stock: '256' },
    { name: 'Furniture Blanket 72 x 80', price: '$12.85', sku: 'WS-3021', stock: '91' },
    { name: 'Four Wheel Furniture Dolly', price: '$44.60', sku: 'WS-3022', stock: '19' },
  ],
}

export function isDemoSet(value: string): value is DemoSet {
  return (DEMO_SETS as readonly string[]).includes(value)
}

/** The records for one set, or undefined when the slug is not one of ours. */
export function productsForSet(set: string): readonly DemoProduct[] | undefined {
  return isDemoSet(set) ? CATALOGUE[set] : undefined
}

/**
 * The whole break. Flag clear renders `class="price"`, flag set renders `class="cost"`.
 * Same text, same layout, same 200 response, so a human sees nothing wrong.
 */
export function priceClassName(broken: boolean): PriceClass {
  return broken ? 'cost' : 'price'
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS demo_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  broken INTEGER NOT NULL,
  changed_at TEXT NOT NULL
);
`

/** The database file the app and the break route share. */
export function demoDbPath(): string {
  return process.env.DOXA_DB_PATH ?? 'data/doxa.db'
}

export function openDemoDb(path: string = demoDbPath()): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA)
  return db
}

export function readBreak(db: Db): DemoBreak {
  const row = db.prepare('SELECT broken, changed_at FROM demo_state WHERE id = 1').get() as
    | { broken: number; changed_at: string }
    | undefined
  if (!row) return { broken: false, changedAt: '' }
  return { broken: row.broken === 1, changedAt: row.changed_at }
}

/** The single row is replaced, never appended, so the flag cannot end up ambiguous. */
export function setBreak(db: Db, broken: boolean, at: string = new Date().toISOString()): DemoBreak {
  db.prepare('INSERT OR REPLACE INTO demo_state (id, broken, changed_at) VALUES (1, ?, ?)').run(
    broken ? 1 : 0,
    at,
  )
  return { broken, changedAt: at }
}

/**
 * One connection per process. Next reloads route modules in development, so the handle
 * hangs off globalThis rather than a plain module variable to avoid leaking connections.
 */
const handle = globalThis as unknown as { doxaDemoDb?: Db }

export function demoDb(): Db {
  if (!handle.doxaDemoDb) handle.doxaDemoDb = openDemoDb()
  return handle.doxaDemoDb
}
