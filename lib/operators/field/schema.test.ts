import { describe, it, expect } from 'vitest'
import { checkRows } from './schema'

describe('checkRows', () => {
  it('passes rows that carry every declared field', () => {
    const r = checkRows([{ title: 'a', url: 'u', date: 'd' }], ['title', 'url', 'date'])
    expect(r.ok).toBe(true)
  })

  it('fails naming the missing field', () => {
    const r = checkRows([{ title: 'a', url: 'u' }], ['title', 'url', 'date'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/date/)
  })

  it('fails on zero rows', () => {
    const r = checkRows([], ['title'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/0 rows/)
  })

  it('fails when a declared field is present but empty on every row', () => {
    const r = checkRows([{ title: '' }, { title: '' }], ['title'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/empty/)
  })

  it('fails when a must-vary field holds one identical value across every row', () => {
    const r = checkRows(
      [{ author: 'Isaac Asimov' }, { author: 'Isaac Asimov' }, { author: 'Isaac Asimov' }],
      ['author'],
      { mustVary: ['author'] },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/identical|same value/i)
  })

  it('allows an identical value in a field that is not declared must-vary', () => {
    // Scraping one group means `group` is legitimately constant on every row.
    const r = checkRows(
      [{ group: 'tech', title: 'a' }, { group: 'tech', title: 'b' }],
      ['group', 'title'],
      { mustVary: ['title'] },
    )
    expect(r.ok).toBe(true)
  })

  it('allows an identical value when there is only one row', () => {
    expect(checkRows([{ author: 'Isaac Asimov' }], ['author'], { mustVary: ['author'] }).ok).toBe(true)
  })

  it('names the field in the identical-value reason so the healer is told what is mis-bound', () => {
    const r = checkRows(
      [{ attributed_to: 'Isaac Asimov' }, { attributed_to: 'Isaac Asimov' }],
      ['attributed_to'],
      { mustVary: ['attributed_to'] },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toMatch(/attributed_to/)
      expect(r.reason).toMatch(/Isaac Asimov/)
    }
  })

  it('reports emptiness before identical value, so an all-blank field is not called mis-bound', () => {
    const r = checkRows([{ author: '' }, { author: '  ' }], ['author'], { mustVary: ['author'] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/empty/)
  })

  it('passes a field that is empty on some rows but not on every row', () => {
    // source_note came back 140 of 149 on the real Wikiquote run. Partial is not a failure.
    const r = checkRows([{ source_note: 'Foundation (1951)' }, { source_note: '' }], ['source_note'])
    expect(r.ok).toBe(true)
  })

  it('rejects a mustVary field that was never declared, rather than skipping the gate', () => {
    const r = checkRows([{ title: 'a' }, { title: 'b' }], ['title'], { mustVary: ['quote_text'] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/quote_text/)
  })

  it('coerces non-string scalars so numeric fields survive as Row values', () => {
    const r = checkRows(
      [{ comment_count: 12 }, { comment_count: 0 }],
      ['comment_count'],
      { mustVary: ['comment_count'] },
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.rows).toEqual([{ comment_count: '12' }, { comment_count: '0' }])
  })

  it('keeps undeclared fields on the returned rows', () => {
    const r = checkRows([{ title: 'a', source_note: 'n' }], ['title'])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.rows[0].source_note).toBe('n')
  })

  it('fails when a row is not an object at all', () => {
    const r = checkRows(['not a row'], ['title'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/not an object/)
  })
})
