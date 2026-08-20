import { NodeSDK, api, tracing } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'

/**
 * SigNoz tracing. One trace per batch, one child span per operator.
 *
 * Tracing is a spectator here, exactly like the floor event listener in the executor.
 * A missing key, an unreachable collector or a slow export degrades to a no-op: every
 * function below still returns, still runs the work it was handed, and never throws on
 * its own account. An error thrown by the wrapped work is re-thrown untouched, because
 * the executor needs it to mark the operator failed.
 *
 * Nothing in this file logs, returns or attaches the ingestion key.
 */

/** The exact shape of `RunOpts['span']` in `lib/executor/run.ts`. */
export type SpanHook = <T>(name: string, attrs: Record<string, unknown>, fn: () => Promise<T>) => Promise<T>

/** Where one operator's work landed in SigNoz. The certificate prints these. */
export type OperatorSpanRef = { traceId: string; spanId: string }

export type SigNozConfig = { url: string; headers: Record<string, string>; serviceName: string }

export type TracingStatus = { enabled: boolean; reason: string }

/** The beats the field wing's repair loop emits, in the order the demo shows them. */
export type RepairStage =
  | 'schema-failed'
  | 'heal-started'
  | 'heal-returned'
  | 'rescrape'
  | 'verify'
  | 'repaired'
  | 'repair-failed'

export type BatchTrace = {
  batchId: string
  /** The SigNoz trace id for the whole batch. Empty string when tracing is off. */
  traceId: string
  /** Pass this straight into `executeRun` as `opts.span`. */
  span: SpanHook
  /** Records an event on the batch root span. */
  event: (name: string, attrs?: Record<string, unknown>) => void
  /** Trace id for one operator. Empty string when the operator was not traced. */
  traceIdOf: (opId: string) => string
  /** Every operator span this batch opened, keyed by operator id. For the certificate. */
  operatorSpans: () => Record<string, OperatorSpanRef>
  /** Closes the root span and flushes. Never rejects, never waits longer than the flush budget. */
  end: (outcome?: BatchOutcome) => Promise<void>
}

export type BatchOutcome = { totalOps?: number; totalMs?: number; failed?: number; skipped?: number; error?: unknown }

type SpanExporterLike = ConstructorParameters<typeof tracing.SimpleSpanProcessor>[0]

export type TracingOverrides = {
  /** Read config from here instead of `process.env`. */
  env?: Record<string, string | undefined>
  /** Export through this instead of OTLP over HTTP. Enables tracing on its own. Used by the tests. */
  exporter?: SpanExporterLike
}

type TracingState = {
  enabled: boolean
  reason: string
  sdk?: NodeSDK
  processor?: { forceFlush(): Promise<void> }
  tracer?: api.Tracer
}

const SERVICE_FALLBACK = 'doxa'
const FLUSH_BUDGET_MS = 3000
const EXPORT_TIMEOUT_MS = 8000
const ATTR_MAX_CHARS = 512

const A = {
  batchId: 'doxa.batch.id',
  batchOps: 'doxa.batch.ops',
  batchMs: 'doxa.batch.ms',
  batchFailed: 'doxa.batch.failed',
  batchSkipped: 'doxa.batch.skipped',
  opId: 'doxa.op.id',
  opMs: 'doxa.op.ms',
  opOps: 'doxa.op.ops',
  opFailed: 'doxa.op.failed',
  opError: 'doxa.op.error',
} as const

// Next.js imports a module once per bundle and again after every hot reload, so the
// singleton hangs off globalThis rather than off module scope.
const GLOBAL_KEY = '__doxa_tracing__'
type GlobalWithTracing = typeof globalThis & { [GLOBAL_KEY]?: TracingState }

// Live batches, newest last. Only used so a repair event still lands somewhere when the
// async context that carried the operator span has been lost.
const liveBatches: { root: api.Span }[] = []

/**
 * Builds the SigNoz OTLP target from the environment. Pure, so the tests can assert on
 * what would be exported without opening a socket. Returns null when the pair is not set,
 * and the reason names the missing variable, never its value.
 */
export function signozConfig(env: Record<string, string | undefined> = process.env): SigNozConfig | null {
  const endpoint = (env.SIGNOZ_ENDPOINT ?? '').trim()
  const key = (env.SIGNOZ_INGESTION_KEY ?? '').trim()
  if (!endpoint || !key) return null
  const base = endpoint.replace(/\/+$/, '')
  const url = base.endsWith('/v1/traces') ? base : `${base}/v1/traces`
  return {
    url,
    headers: { 'signoz-ingestion-key': key },
    serviceName: (env.SIGNOZ_SERVICE_NAME ?? '').trim() || SERVICE_FALLBACK,
  }
}

/** Why tracing is off, without naming a value. */
function disabledReason(env: Record<string, string | undefined>): string {
  const missing = ['SIGNOZ_ENDPOINT', 'SIGNOZ_INGESTION_KEY'].filter(k => !(env[k] ?? '').trim())
  return missing.length === 2
    ? 'SIGNOZ_ENDPOINT and SIGNOZ_INGESTION_KEY are not set, so spans are dropped.'
    : `${missing[0]} is not set, so spans are dropped.`
}

/**
 * Starts the SDK once per process. Calling it again returns the status of the first call
 * and starts nothing, which is what keeps repeated Next.js imports from stacking exporters.
 */
export function initTracing(overrides: TracingOverrides = {}): TracingStatus {
  const g = globalThis as GlobalWithTracing
  const existing = g[GLOBAL_KEY]
  if (existing) return { enabled: existing.enabled, reason: existing.reason }

  const env = overrides.env ?? process.env
  const config = signozConfig(env)
  const exporter = overrides.exporter ?? (config ? otlpExporter(config) : undefined)

  if (!exporter) {
    const state: TracingState = { enabled: false, reason: disabledReason(env) }
    g[GLOBAL_KEY] = state
    return { enabled: false, reason: state.reason }
  }

  const state: TracingState = { enabled: false, reason: 'not started' }
  try {
    // An injected exporter is a test exporter: export on span end so the assertion can read
    // it without a flush. The real path batches, so a slow collector never blocks an operator.
    const processor = overrides.exporter
      ? new tracing.SimpleSpanProcessor(exporter)
      : new tracing.BatchSpanProcessor(exporter, { scheduledDelayMillis: 1000, exportTimeoutMillis: EXPORT_TIMEOUT_MS })
    const serviceName = config?.serviceName ?? SERVICE_FALLBACK
    const sdk = new NodeSDK({
      resource: defaultResource().merge(resourceFromAttributes({
        [ATTR_SERVICE_NAME]: serviceName,
        'doxa.env': process.env.NODE_ENV ?? 'development',
      })),
      spanProcessors: [processor],
    })
    sdk.start()
    state.enabled = true
    state.reason = 'exporting to SigNoz'
    state.sdk = sdk
    state.processor = processor
    state.tracer = api.trace.getTracer(SERVICE_FALLBACK)
  } catch (err) {
    // A tracer that cannot start is a tracer that is off. It is never a failed request.
    state.enabled = false
    state.reason = `tracing failed to start: ${messageOf(err)}`
  }
  g[GLOBAL_KEY] = state
  return { enabled: state.enabled, reason: state.reason }
}

function otlpExporter(config: SigNozConfig): SpanExporterLike {
  return new OTLPTraceExporter({ url: config.url, headers: config.headers, timeoutMillis: EXPORT_TIMEOUT_MS })
}

export function tracingStatus(): TracingStatus {
  const state = ensure()
  return { enabled: state.enabled, reason: state.reason }
}

function ensure(): TracingState {
  const g = globalThis as GlobalWithTracing
  if (!g[GLOBAL_KEY]) initTracing()
  return g[GLOBAL_KEY] as TracingState
}

/**
 * Opens the root span for one batch and hands back the span hook the executor wants.
 * Every operator span made through `trace.span` is parented explicitly, so one batch is
 * one trace even though the operators run concurrently.
 */
export function startBatch(batchId: string, attrs: Record<string, unknown> = {}): BatchTrace {
  const state = ensure()
  const tracer = state.tracer
  if (!state.enabled || !tracer) return noopBatch(batchId)

  const root = tracer.startSpan('doxa.batch', {
    attributes: { [A.batchId]: batchId, ...toAttributes(attrs, 'doxa.batch.') },
  }, api.context.active())
  const rootCtx = api.trace.setSpan(api.context.active(), root)
  const refs = new Map<string, OperatorSpanRef>()
  const entry = { root }
  liveBatches.push(entry)

  const span: SpanHook = (name, spanAttrs, fn) =>
    runOperatorSpan(tracer, rootCtx, name, spanAttrs, fn, (opId, ref) => refs.set(opId, ref))

  return {
    batchId,
    traceId: root.spanContext().traceId,
    span,
    event: (name, eventAttrs) => {
      try {
        root.addEvent(eventName(name), toAttributes(eventAttrs ?? {}, 'doxa.'))
      } catch {
        // A trace event never takes a batch down.
      }
    },
    traceIdOf: (opId: string) => refs.get(opId)?.traceId ?? '',
    operatorSpans: () => Object.fromEntries(refs),
    end: async (outcome?: BatchOutcome) => {
      try {
        if (outcome) {
          if (typeof outcome.totalOps === 'number') root.setAttribute(A.batchOps, outcome.totalOps)
          if (typeof outcome.totalMs === 'number') root.setAttribute(A.batchMs, outcome.totalMs)
          if (typeof outcome.failed === 'number') root.setAttribute(A.batchFailed, outcome.failed)
          if (typeof outcome.skipped === 'number') root.setAttribute(A.batchSkipped, outcome.skipped)
          if (outcome.error !== undefined) {
            root.setStatus({ code: api.SpanStatusCode.ERROR, message: messageOf(outcome.error) })
          }
        }
        root.end()
      } catch {
        // Ignored on purpose. See the file comment.
      }
      const at = liveBatches.indexOf(entry)
      if (at >= 0) liveBatches.splice(at, 1)
      await flushTracing()
    },
  }
}

function noopBatch(batchId: string): BatchTrace {
  return {
    batchId,
    traceId: '',
    span: (_name, _attrs, fn) => fn(),
    event: () => {},
    traceIdOf: () => '',
    operatorSpans: () => ({}),
    end: async () => {},
  }
}

/**
 * The operator span on its own, parented to whatever is active. `startBatch(...).span` is
 * the one to hand the executor, because it also parents to the batch and records trace ids.
 */
export const withSpan: SpanHook = (name, attrs, fn) => {
  const state = ensure()
  if (!state.enabled || !state.tracer) return fn()
  return runOperatorSpan(state.tracer, api.context.active(), name, attrs, fn)
}

function runOperatorSpan<T>(
  tracer: api.Tracer,
  parent: api.Context,
  name: string,
  attrs: Record<string, unknown>,
  fn: () => Promise<T>,
  onOpen?: (opId: string, ref: OperatorSpanRef) => void,
): Promise<T> {
  let span: api.Span
  try {
    span = tracer.startSpan(spanName(name), {
      attributes: { [A.opId]: name, ...toAttributes(attrs, 'doxa.op.') },
    }, parent)
  } catch {
    return fn()
  }
  const ctx = span.spanContext()
  onOpen?.(name, { traceId: ctx.traceId, spanId: ctx.spanId })
  const child = api.trace.setSpan(parent, span)
  // A caller that throws before its first await must still close its span.
  let work: Promise<T>
  try {
    work = api.context.with(child, fn)
  } catch (err) {
    work = Promise.reject(err)
  }
  return finish(span, Date.now(), work)
}

async function finish<T>(span: api.Span, started: number, work: Promise<T>): Promise<T> {
  try {
    const out = await work
    safely(() => {
      span.setAttribute(A.opMs, Date.now() - started)
      span.setAttribute(A.opFailed, false)
      const ops = opsOf(out)
      if (ops !== undefined) span.setAttribute(A.opOps, ops)
      for (const [k, v] of Object.entries(readingsOf(out))) span.setAttribute(`doxa.reading.${k}`, v)
      span.setStatus({ code: api.SpanStatusCode.OK })
    })
    return out
  } catch (err) {
    safely(() => {
      span.setAttribute(A.opMs, Date.now() - started)
      span.setAttribute(A.opFailed, true)
      span.setAttribute(A.opError, messageOf(err))
      span.recordException(err instanceof Error ? err : new Error(messageOf(err)))
      span.setStatus({ code: api.SpanStatusCode.ERROR, message: messageOf(err) })
    })
    throw err
  } finally {
    safely(() => span.end())
  }
}

/**
 * Records an event on the operator span that is running right now. Call it from inside an
 * operator's `run`. With no span in context it falls back to the newest open batch root, so
 * the beat still shows on the trace rather than disappearing.
 */
export function traceEvent(name: string, attrs: Record<string, unknown> = {}): void {
  safely(() => {
    const target = api.trace.getActiveSpan() ?? liveBatches[liveBatches.length - 1]?.root
    if (!target) return
    target.addEvent(eventName(name), toAttributes(attrs, 'doxa.'))
  })
}

/**
 * The field wing's repair loop, one call per beat: the schema failure, the heal, the
 * re-scrape of the original input, and the verify scrape on an input this run has not
 * touched. The demo reads these off the SigNoz timeline.
 */
export function recordRepair(stage: RepairStage, attrs: Record<string, unknown> = {}): void {
  traceEvent(`doxa.repair.${stage}`, { stage, ...attrs })
}

/** Pushes queued spans out. Never rejects, never waits longer than the budget. */
export async function flushTracing(timeoutMs = FLUSH_BUDGET_MS): Promise<void> {
  const state = (globalThis as GlobalWithTracing)[GLOBAL_KEY]
  if (!state?.processor) return
  let timer: ReturnType<typeof setTimeout> | undefined
  // The catch goes on before the race. A rejection nobody is waiting on any more is an
  // unhandled rejection, and Node takes the process down for one of those.
  const flushed = state.processor.forceFlush().catch(() => {})
  try {
    await Promise.race([flushed, new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs) })])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Shuts the SDK down and clears the singleton, so a later init starts clean. */
export async function shutdownTracing(): Promise<void> {
  const g = globalThis as GlobalWithTracing
  const state = g[GLOBAL_KEY]
  g[GLOBAL_KEY] = undefined
  liveBatches.length = 0
  if (!state?.sdk) return
  try {
    await state.sdk.shutdown()
  } catch {
    // Same rule on the way out as on the way in.
  }
  api.trace.disable()
  api.context.disable()
}

function spanName(id: string): string {
  return id.startsWith('doxa.') ? id : `doxa.op.${id}`
}

function eventName(name: string): string {
  return name.startsWith('doxa.') ? name : `doxa.${name}`
}

/**
 * OpenTelemetry accepts primitives and arrays of one primitive type. Anything else is
 * stringified rather than dropped, because a truncated attribute still tells you more
 * than a missing one. A key that already carries a dot is left alone.
 */
function toAttributes(input: Record<string, unknown>, prefix: string): api.Attributes {
  const out: api.Attributes = {}
  for (const [rawKey, value] of Object.entries(input)) {
    const attr = toAttributeValue(value)
    if (attr === undefined) continue
    out[rawKey.includes('.') ? rawKey : `${prefix}${rawKey}`] = attr
  }
  return out
}

function toAttributeValue(value: unknown): api.AttributeValue | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') return clip(value)
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return []
    if (value.every(v => typeof v === 'string')) return value as string[]
    if (value.every(v => typeof v === 'number' && Number.isFinite(v))) return value as number[]
    if (value.every(v => typeof v === 'boolean')) return value as boolean[]
    return value.map(v => clip(typeof v === 'string' ? v : stringify(v)))
  }
  return clip(stringify(value))
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function clip(s: string): string {
  return s.length > ATTR_MAX_CHARS ? `${s.slice(0, ATTR_MAX_CHARS)}...` : s
}

/** The real op count off an `OperatorResult`, without importing the executor. */
function opsOf(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined
  const ops = (value as { ops?: unknown }).ops
  return typeof ops === 'number' && Number.isFinite(ops) ? ops : undefined
}

function readingsOf(value: unknown): Record<string, number | string> {
  if (!value || typeof value !== 'object') return {}
  const readings = (value as { readings?: unknown }).readings
  if (!readings || typeof readings !== 'object') return {}
  const out: Record<string, number | string> = {}
  for (const [k, v] of Object.entries(readings as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (typeof v === 'string') out[k] = clip(v)
  }
  return out
}

function safely(fn: () => void): void {
  try {
    fn()
  } catch {
    // Tracing is a spectator.
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
