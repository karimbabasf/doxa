import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tracing } from '@opentelemetry/sdk-node'
import {
  signozConfig,
  initTracing,
  tracingStatus,
  startBatch,
  withSpan,
  traceEvent,
  recordRepair,
  flushTracing,
  shutdownTracing,
  type SpanHook,
} from './tracing'
import { executeRun } from './executor/run'
import type { Ctx, Operator } from './types'

// Nothing here opens a socket. Every enabled test exports into memory, so the assertions
// read the exact spans that would have gone to SigNoz.
const exporter = () => new tracing.InMemorySpanExporter()

const op = (id: string, needs: string[] = [], impl?: () => Promise<void>): Operator => ({
  id, name: id, wing: 'field', blurb: '', needs, costUnits: 1, estMs: 1, estOps: 1, touches: [],
  run: async () => { if (impl) await impl(); return { id, ops: 12, readings: { repaired: 'yes' } } },
})

const ctx = (): Ctx => ({ opinion: 'x', batchId: 'b1', results: new Map() })
const opts = (span?: SpanHook) => ({ concurrency: 4, timeoutMs: 2000, onEvent: () => {}, span })

const saved = { endpoint: process.env.SIGNOZ_ENDPOINT, key: process.env.SIGNOZ_INGESTION_KEY }

beforeEach(async () => {
  await shutdownTracing()
  delete process.env.SIGNOZ_ENDPOINT
  delete process.env.SIGNOZ_INGESTION_KEY
})

afterEach(async () => {
  await shutdownTracing()
  if (saved.endpoint === undefined) delete process.env.SIGNOZ_ENDPOINT
  else process.env.SIGNOZ_ENDPOINT = saved.endpoint
  if (saved.key === undefined) delete process.env.SIGNOZ_INGESTION_KEY
  else process.env.SIGNOZ_INGESTION_KEY = saved.key
})

describe('signozConfig', () => {
  it('builds the traces URL and the ingestion header', () => {
    const c = signozConfig({ SIGNOZ_ENDPOINT: 'https://ingest.example.signoz.cloud', SIGNOZ_INGESTION_KEY: 'k' })
    expect(c).toEqual({
      url: 'https://ingest.example.signoz.cloud/v1/traces',
      headers: { 'signoz-ingestion-key': 'k' },
      serviceName: 'doxa',
    })
  })

  it('does not append the path twice and drops a trailing slash', () => {
    const a = signozConfig({ SIGNOZ_ENDPOINT: 'https://x.signoz.cloud/v1/traces', SIGNOZ_INGESTION_KEY: 'k' })
    const b = signozConfig({ SIGNOZ_ENDPOINT: 'https://x.signoz.cloud/', SIGNOZ_INGESTION_KEY: 'k' })
    expect(a?.url).toBe('https://x.signoz.cloud/v1/traces')
    expect(b?.url).toBe('https://x.signoz.cloud/v1/traces')
  })

  it('returns null when half configured, and the reason never carries the key', () => {
    expect(signozConfig({ SIGNOZ_ENDPOINT: 'https://x.signoz.cloud' })).toBeNull()
    expect(signozConfig({ SIGNOZ_INGESTION_KEY: 'sup3r-s3cret' })).toBeNull()
    const status = initTracing({ env: { SIGNOZ_INGESTION_KEY: 'sup3r-s3cret' } })
    expect(status.enabled).toBe(false)
    expect(status.reason).toContain('SIGNOZ_ENDPOINT')
    expect(status.reason).not.toContain('sup3r-s3cret')
  })
})

describe('degrades to a no-op when SigNoz is not configured', () => {
  it('runs a whole batch, returns values and never throws', async () => {
    expect(tracingStatus().enabled).toBe(false)

    const batch = startBatch('b1')
    expect(batch.traceId).toBe('')

    const result = await executeRun([op('A'), op('B', ['A'])], ctx(), opts(batch.span))
    expect(result.totalOps).toBe(24)
    expect(result.failed).toEqual([])

    // Every other entry point is safe to call with tracing off.
    batch.event('signed')
    traceEvent('anything')
    recordRepair('schema-failed', { reason: 'quote_text missing' })
    expect(batch.operatorSpans()).toEqual({})
    expect(batch.traceIdOf('A')).toBe('')
    await expect(batch.end({ totalOps: 24 })).resolves.toBeUndefined()
    await expect(withSpan('A', {}, async () => 'value')).resolves.toBe('value')
  })

  it('still lets the operator error through, so the executor can fail it', async () => {
    const batch = startBatch('b1')
    const boom = async () => { throw new Error('scraper returned nothing') }
    await expect(batch.span('A', {}, boom)).rejects.toThrow('scraper returned nothing')
    const result = await executeRun([op('A', [], boom)], ctx(), opts(batch.span))
    expect(result.failed).toEqual(['A'])
  })
})

describe('spans', () => {
  it('puts one trace on the batch and one child span on every operator', async () => {
    const exp = exporter()
    expect(initTracing({ exporter: exp }).enabled).toBe(true)

    const batch = startBatch('b1', { opinion: 'x' })
    await executeRun([op('A'), op('B', ['A'])], ctx(), opts(batch.span))
    await batch.end({ totalOps: 24, failed: 0 })

    const spans = exp.getFinishedSpans()
    expect(spans.map(s => s.name).sort()).toEqual(['doxa.batch', 'doxa.op.A', 'doxa.op.B'])
    expect(new Set(spans.map(s => s.spanContext().traceId)).size).toBe(1)
    expect(batch.traceId).toBe(spans[0].spanContext().traceId)

    const a = spans.find(s => s.name === 'doxa.op.A')!
    expect(a.attributes['doxa.op.id']).toBe('A')
    expect(a.attributes['doxa.op.wing']).toBe('field')
    expect(a.attributes['doxa.op.needs']).toEqual([])
    expect(a.attributes['doxa.op.ops']).toBe(12)
    expect(a.attributes['doxa.op.failed']).toBe(false)
    expect(a.attributes['doxa.reading.repaired']).toBe('yes')
    expect(typeof a.attributes['doxa.op.ms']).toBe('number')

    const b = spans.find(s => s.name === 'doxa.op.B')!
    expect(b.attributes['doxa.op.needs']).toEqual(['A'])

    const root = spans.find(s => s.name === 'doxa.batch')!
    expect(root.attributes['doxa.batch.id']).toBe('b1')
    expect(root.attributes['doxa.batch.ops']).toBe(24)
  })

  it('hands back a trace id and a span id per operator, for the certificate', async () => {
    const exp = exporter()
    initTracing({ exporter: exp })
    const batch = startBatch('b1')
    await executeRun([op('A'), op('B')], ctx(), opts(batch.span))
    await batch.end()

    const refs = batch.operatorSpans()
    expect(Object.keys(refs).sort()).toEqual(['A', 'B'])
    expect(refs.A.traceId).toBe(batch.traceId)
    expect(refs.A.spanId).not.toBe(refs.B.spanId)
    expect(batch.traceIdOf('A')).toBe(batch.traceId)
    expect(batch.traceIdOf('nobody')).toBe('')
  })

  it('marks a failed operator on its span and re-throws the error unchanged', async () => {
    const exp = exporter()
    initTracing({ exporter: exp })
    const batch = startBatch('b1')
    const boom = async () => { throw new Error('schema gate failed on attributed_to') }
    await expect(batch.span('PRIOR-ART', { wing: 'field' }, boom)).rejects.toThrow('schema gate failed on attributed_to')
    await batch.end()

    const span = exp.getFinishedSpans().find(s => s.name === 'doxa.op.PRIOR-ART')!
    expect(span.attributes['doxa.op.failed']).toBe(true)
    expect(span.attributes['doxa.op.error']).toBe('schema gate failed on attributed_to')
    expect(span.status.code).toBe(2)
    expect(span.events.map(e => e.name)).toContain('exception')
  })

  it('records the repair beats as events on the operator span', async () => {
    const exp = exporter()
    initTracing({ exporter: exp })
    const batch = startBatch('b1')

    await batch.span('PRIOR-ART', { wing: 'field' }, async () => {
      recordRepair('schema-failed', { reason: 'attributed_to identical on 149 rows' })
      recordRepair('heal-started', { collectorId: 'c_mt12spi4173gff7wai' })
      recordRepair('heal-returned', { healDiff: 'quote-author to citation' })
      recordRepair('rescrape', { url: 'https://en.wikiquote.org/wiki/Technology' })
      recordRepair('verify', { url: 'https://en.wikiquote.org/wiki/Science', passed: true })
      recordRepair('repaired', { repaired: true })
      return { id: 'PRIOR-ART', ops: 1, readings: {} }
    })
    await batch.end()

    const span = exp.getFinishedSpans().find(s => s.name === 'doxa.op.PRIOR-ART')!
    expect(span.events.map(e => e.name)).toEqual([
      'doxa.repair.schema-failed',
      'doxa.repair.heal-started',
      'doxa.repair.heal-returned',
      'doxa.repair.rescrape',
      'doxa.repair.verify',
      'doxa.repair.repaired',
    ])
    const verify = span.events.find(e => e.name === 'doxa.repair.verify')!
    expect(verify.attributes?.['doxa.url']).toBe('https://en.wikiquote.org/wiki/Science')
    expect(verify.attributes?.['doxa.passed']).toBe(true)
  })

  it('falls back to the batch root when no operator span is in context', async () => {
    const exp = exporter()
    initTracing({ exporter: exp })
    const batch = startBatch('b1')
    traceEvent('gate.signed', { by: 'karim' })
    await batch.end()

    const root = exp.getFinishedSpans().find(s => s.name === 'doxa.batch')!
    expect(root.events.map(e => e.name)).toEqual(['doxa.gate.signed'])
  })

  it('starts the SDK once per process', async () => {
    const first = exporter()
    const second = exporter()
    initTracing({ exporter: first })
    const again = initTracing({ exporter: second })
    expect(again.enabled).toBe(true)

    await withSpan('A', {}, async () => ({ id: 'A', ops: 3, readings: {} }))
    await flushTracing()
    expect(first.getFinishedSpans().map(s => s.name)).toEqual(['doxa.op.A'])
    expect(second.getFinishedSpans()).toEqual([])
  })

  it('keeps unusual attribute values instead of dropping them', async () => {
    const exp = exporter()
    initTracing({ exporter: exp })
    await withSpan('A', { needs: ['X', 'Y'], nested: { a: 1 }, nothing: undefined, count: 3 }, async () => 1)
    await flushTracing()

    const span = exp.getFinishedSpans()[0]
    expect(span.attributes['doxa.op.needs']).toEqual(['X', 'Y'])
    expect(span.attributes['doxa.op.nested']).toBe('{"a":1}')
    expect(span.attributes['doxa.op.count']).toBe(3)
    expect('doxa.op.nothing' in span.attributes).toBe(false)
  })
})
