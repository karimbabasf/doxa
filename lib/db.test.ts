import { describe, it, expect } from 'vitest'
import { openDb, insertBatch, getBatch, insertResult, getResults, setBatchEmbedding } from './db'

describe('db', () => {
  it('round-trips a batch', () => {
    const db = openDb(':memory:')
    insertBatch(db, { id: 'b1', opinion: 'Tabs beat spaces.', createdAt: '2026-08-19T00:00:00Z' })
    expect(getBatch(db, 'b1')?.opinion).toBe('Tabs beat spaces.')
  })

  it('returns undefined for a batch that does not exist', () => {
    const db = openDb(':memory:')
    expect(getBatch(db, 'nope')).toBeUndefined()
  })

  it('stores an embedding on the batch for the future graph', () => {
    const db = openDb(':memory:')
    insertBatch(db, { id: 'b2', opinion: 'x y z', createdAt: '2026-08-19T00:00:00Z', embedding: [0.1, 0.2] })
    expect(getBatch(db, 'b2')?.embedding).toEqual([0.1, 0.2])
  })

  it('leaves the embedding undefined when none was given', () => {
    const db = openDb(':memory:')
    insertBatch(db, { id: 'b4', opinion: 'x y z', createdAt: '2026-08-19T00:00:00Z' })
    expect(getBatch(db, 'b4')?.embedding).toBeUndefined()
  })

  it('can attach an embedding after the run, which is the graph seam', () => {
    const db = openDb(':memory:')
    insertBatch(db, { id: 'b5', opinion: 'x y z', createdAt: '2026-08-19T00:00:00Z' })
    setBatchEmbedding(db, 'b5', [0.3, 0.4])
    expect(getBatch(db, 'b5')?.embedding).toEqual([0.3, 0.4])
  })

  it('returns results in insertion order', () => {
    const db = openDb(':memory:')
    insertBatch(db, { id: 'b3', opinion: 'a b c', createdAt: '2026-08-19T00:00:00Z' })
    insertResult(db, 'b3', { id: 'GEMATRIA', ops: 12, readings: { digitalRoot: 4 } })
    insertResult(db, 'b3', { id: 'ENTROPY', ops: 30, readings: { shannon: 3.1 } })
    expect(getResults(db, 'b3').map((r) => r.id)).toEqual(['GEMATRIA', 'ENTROPY'])
  })

  it('round-trips a result payload intact', () => {
    const db = openDb(':memory:')
    insertBatch(db, { id: 'b6', opinion: 'a b c', createdAt: '2026-08-19T00:00:00Z' })
    insertResult(db, 'b6', { id: 'ENTROPY', ops: 30, readings: { shannon: 3.1 }, notes: ['hello'] })
    expect(getResults(db, 'b6')[0]).toEqual({ id: 'ENTROPY', ops: 30, readings: { shannon: 3.1 }, notes: ['hello'] })
  })
})
