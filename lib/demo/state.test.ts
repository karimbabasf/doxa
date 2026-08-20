import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEMO_SETS,
  isDemoSet,
  openDemoDb,
  priceClassName,
  productsForSet,
  readBreak,
  setBreak,
} from './state'

describe('the break flag', () => {
  it('reports the page whole on a database that has never been broken', () => {
    const db = openDemoDb(':memory:')
    expect(readBreak(db).broken).toBe(false)
  })

  it('renders class="price" while the flag is clear and class="cost" once it is set', () => {
    expect(priceClassName(false)).toBe('price')
    expect(priceClassName(true)).toBe('cost')
  })

  it('sets the flag and reads it back', () => {
    const db = openDemoDb(':memory:')
    setBreak(db, true)
    expect(readBreak(db).broken).toBe(true)
  })

  it('clears the flag again, because rehearsal restores in one click', () => {
    const db = openDemoDb(':memory:')
    setBreak(db, true)
    setBreak(db, false)
    expect(readBreak(db).broken).toBe(false)
  })

  it('keeps one row however many times it is pressed', () => {
    const db = openDemoDb(':memory:')
    setBreak(db, true)
    setBreak(db, true)
    setBreak(db, false)
    const rows = db.prepare('SELECT COUNT(*) AS n FROM demo_state').get() as { n: number }
    expect(rows.n).toBe(1)
  })

  it('stamps the moment it changed, so the floor can show when the break happened', () => {
    const db = openDemoDb(':memory:')
    const written = setBreak(db, true, '2026-08-21T18:04:00.000Z')
    expect(written.changedAt).toBe('2026-08-21T18:04:00.000Z')
    expect(readBreak(db).changedAt).toBe('2026-08-21T18:04:00.000Z')
  })

  it('survives a restart, because the flag lives in SQLite and not in memory', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'doxa-demo-')), 'demo.db')
    const first = openDemoDb(path)
    setBreak(first, true)
    first.close()

    const second = openDemoDb(path)
    expect(readBreak(second).broken).toBe(true)
    second.close()
  })
})

describe('the shop catalogue', () => {
  it('serves the three sets the verify scrape needs', () => {
    expect(DEMO_SETS).toEqual(['a', 'b', 'c'])
  })

  it('names a known set and refuses an unknown one', () => {
    expect(isDemoSet('a')).toBe(true)
    expect(isDemoSet('z')).toBe(false)
    expect(productsForSet('z')).toBeUndefined()
  })

  it('returns the same records every time, so a scrape is reproducible', () => {
    expect(productsForSet('a')).toEqual(productsForSet('a'))
  })

  it('holds products in every set', () => {
    for (const set of DEMO_SETS) {
      expect(productsForSet(set)!.length).toBeGreaterThan(3)
    }
  })

  it('gives every product all four declared fields, filled', () => {
    for (const set of DEMO_SETS) {
      for (const p of productsForSet(set)!) {
        expect(p.name.length).toBeGreaterThan(0)
        expect(p.price.length).toBeGreaterThan(0)
        expect(p.sku.length).toBeGreaterThan(0)
        expect(p.stock.length).toBeGreaterThan(0)
      }
    }
  })

  it('varies name and price inside a set, since the schema gate fails one repeated value', () => {
    for (const set of DEMO_SETS) {
      const products = productsForSet(set)!
      expect(new Set(products.map((p) => p.name)).size).toBe(products.length)
      expect(new Set(products.map((p) => p.price)).size).toBe(products.length)
    }
  })

  it('shares no sku between sets, so a verify scrape reads an untouched page', () => {
    const skus = DEMO_SETS.flatMap((set) => productsForSet(set)!.map((p) => p.sku))
    expect(new Set(skus).size).toBe(skus.length)
  })

  it('shares no product name between sets either', () => {
    const names = DEMO_SETS.flatMap((set) => productsForSet(set)!.map((p) => p.name))
    expect(new Set(names).size).toBe(names.length)
  })

  it('keeps every field free of an em or en dash, because the scrape lands in our copy', () => {
    const dashes = /[\u2013\u2014]/
    for (const set of DEMO_SETS) {
      for (const p of productsForSet(set)!) {
        expect(`${p.name} ${p.price} ${p.sku} ${p.stock}`).not.toMatch(dashes)
      }
    }
  })
})
