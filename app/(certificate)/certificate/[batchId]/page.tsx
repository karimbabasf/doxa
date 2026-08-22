import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isAbsolute, join } from 'node:path'
import Specimen from '@/components/Specimen'
import { getBatch, getResults, getWorkOrder, openDb } from '@/lib/db'
import type { Attribution } from '@/lib/foundry/merge'
import { encodePng, pngDataUrl } from '@/lib/foundry/png'
import { DEFAULT_SIZE, renderSpecimen } from '@/lib/foundry/render'
// Importing the barrel is what fills the registry, so the certificate can name the wing and
// blurb behind every reading. Next evaluates a server component's module graph more than
// once and every operator file registers itself at import time, which used to throw on the
// second pass; `register` now treats an identical re-registration as the re-evaluation it is.
import '@/lib/operators'
import { allOperators } from '@/lib/operators/registry'
import {
  ALL_RENDER_PATHS,
  type Evidence,
  type Operator,
  type OperatorResult,
  type RenderParams,
  type RenderPath,
  type WorkOrder,
} from '@/lib/types'

/**
 * The certificate.
 *
 * It reports one batch and nothing else, out of what the run actually wrote down:
 * the opinion, the signed work order, every operator that ran, the outside evidence,
 * the reconciliation, and the specimen with the assays behind each of its parameters.
 *
 * Where a stage has not run, the page says so in words. It never prints a zero, a
 * dash or an empty string in the place a real reading would go, because a certificate
 * that reads as complete when it is not is worse than one that admits a gap.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteProps = { params: Promise<{ batchId: string }> }

type Db = ReturnType<typeof openDb>

type Struck = { params: RenderParams; attribution: Attribution; png: Uint8Array | null }

type Loaded = {
  batch: { id: string; opinion: string; createdAt: string }
  reconciliation: string | null
  work: { order: WorkOrder; signedAt: string | null } | undefined
  results: OperatorResult[]
  specimen: Struck | null
  specimenProblem: string | null
}

/**
 * The store the run wrote to. The default matches `app/api/plan/db.ts` and
 * `lib/demo/state.ts` so the whole app points at one file. Both env names are read
 * because `app/api/run/route.ts` currently uses the shorter one.
 */
function databasePath(): string {
  const configured = process.env.DOXA_DB_PATH ?? process.env.DOXA_DB ?? 'data/doxa.db'
  return isAbsolute(configured) ? configured : join(process.cwd(), configured)
}

/** `batches.verdict` holds the reconciliation paragraph. It has no accessor in lib/db.ts yet. */
function readReconciliation(db: Db, batchId: string): string | null {
  const row = db.prepare('SELECT verdict FROM batches WHERE id = ?').get(batchId) as
    | { verdict: string | null }
    | undefined
  const text = row?.verdict?.trim()
  return text ? text : null
}

function readRenderParams(value: unknown): RenderParams | null {
  const p = value as RenderParams | null
  if (!p || typeof p !== 'object') return null
  if (!p.field || !p.primitives || !p.dither || !p.palette || !p.frame) return null
  if (typeof p.seed !== 'number') return null
  return p
}

function readSpecimen(db: Db, batchId: string): { specimen: Struck | null; problem: string | null } {
  const row = db.prepare('SELECT params, attribution, png FROM specimens WHERE batch_id = ?').get(
    batchId,
  ) as { params: string; attribution: string; png: Buffer | null } | undefined

  if (!row) return { specimen: null, problem: null }

  try {
    const params = readRenderParams(JSON.parse(row.params))
    if (!params) {
      return { specimen: null, problem: 'the stored render parameters are not a full parameter set' }
    }
    const attribution = JSON.parse(row.attribution) as Attribution
    return {
      specimen: { params, attribution, png: row.png ? new Uint8Array(row.png) : null },
      problem: null,
    }
  } catch (error) {
    return { specimen: null, problem: `the stored specimen row did not parse: ${String(error)}` }
  }
}

function load(batchId: string): Loaded | null {
  const db = openDb(databasePath())
  try {
    const batch = getBatch(db, batchId)
    if (!batch) return null
    const { specimen, problem } = readSpecimen(db, batchId)
    return {
      batch: { id: batch.id, opinion: batch.opinion, createdAt: batch.createdAt },
      reconciliation: readReconciliation(db, batchId),
      work: getWorkOrder(db, batchId),
      results: getResults(db, batchId),
      specimen,
      specimenProblem: problem,
    }
  } finally {
    db.close()
  }
}

/**
 * Catalogue metadata (name, wing, needs) for a result id. The page never depends on it:
 * everything a reader needs is in the database, and this only adds the label an operator
 * gives itself. An id the catalogue does not know still reports in full.
 */
function catalogue(): Map<string, Operator> {
  return new Map(allOperators().map(op => [op.id, op]))
}

const TRACE_KEYS = ['traceId', 'trace_id', 'traceID', 'spanId', 'span_id']
const DURATION_KEYS = ['ms', 'durationMs', 'duration_ms', 'elapsedMs']

function traceIdOf(result: OperatorResult): string | null {
  for (const key of TRACE_KEYS) {
    const value = result.readings[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  for (const note of result.notes ?? []) {
    const found = /\btrace(?:\s*id)?[:=\s]\s*([0-9a-f]{16,32})\b/i.exec(note)
    if (found) return found[1]
  }
  return null
}

function durationOf(result: OperatorResult): number | null {
  for (const key of DURATION_KEYS) {
    const value = result.readings[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function formatValue(value: number | string | boolean | undefined): string {
  if (value === undefined) return 'unset'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3)
  return value
}

function valueAt(params: RenderParams, path: RenderPath): number | string | boolean | undefined {
  if (path === 'seed') return params.seed
  const [group, leaf] = path.split('.')
  const bag = params[group as 'field' | 'primitives' | 'dither' | 'palette' | 'frame'] as
    | Record<string, number | string | boolean>
    | undefined
  return bag?.[leaf]
}

const isColourPath = (path: RenderPath) => path === 'palette.ink' || path === 'palette.ground'

const MODE_CLASS: Record<string, string> = {
  sole: 'text-ink-faint',
  blended: 'text-signal',
  contested: 'text-signal underline decoration-dotted underline-offset-2',
}

/**
 * The screen is a dark refinery readout. Paper is not, so print flips the tokens to
 * ink on white and stops the entrance animations from freezing an element at zero
 * opacity in the printed copy.
 */
const PRINT_CSS = `
@media print {
  @page { margin: 15mm; }
  html, body { background: #ffffff !important; color: #101010 !important; }
  .certificate {
    --ground: #ffffff;
    --ground-raised: #ffffff;
    --ground-sunk: #ffffff;
    --ink: #101010;
    --ink-dim: #3f3f3f;
    --ink-faint: #6a6a6a;
    --rule: #c9c9c9;
    --rule-bright: #9a9a9a;
    --signal: #a63a17;
    background: #ffffff;
    color: #101010;
    font-size: 9.5pt;
    max-width: none;
    padding: 0 2mm;
  }
  .certificate a { color: #101010; text-decoration: none; }
  .certificate .keep-together { break-inside: avoid; page-break-inside: avoid; }
  .certificate section { break-inside: auto; orphans: 2; widows: 2; }
  /* A section title alone at the foot of a page is not a page of anything. */
  .certificate .section-head { break-after: avoid; page-break-after: avoid; }
  .certificate * { animation: none !important; opacity: 1 !important; }
  .certificate .specimen-print {
    display: block !important;
    width: 96mm;
    height: 96mm;
    image-rendering: pixelated;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
}
`

function Absent({ children }: { children: React.ReactNode }) {
  return <span className="text-ink-faint">{children}</span>
}

function SectionHead({ index, title, note }: { index: string; title: string; note?: string }) {
  return (
    <div className="section-head mb-3 flex items-baseline gap-3 border-b border-rule pb-1">
      <span className="text-ink-faint">{index}</span>
      <h2 className="tracking-[0.18em] uppercase">{title}</h2>
      {note ? <span className="ml-auto text-ink-faint">{note}</span> : null}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-ink-faint">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  )
}

function Section({
  index,
  title,
  note,
  order,
  children,
}: {
  index: string
  title: string
  note?: string
  order: number
  children: React.ReactNode
}) {
  return (
    <section
      className="row-in mt-10"
      style={{ animationDelay: `${Math.min(order, 6) * 40}ms`, animationDuration: '420ms' }}
    >
      <SectionHead index={index} title={title} note={note} />
      {children}
    </section>
  )
}

export async function generateMetadata({ params }: RouteProps) {
  const { batchId } = await params
  return { title: `DOXA certificate ${batchId}` }
}

export default async function CertificatePage({ params }: RouteProps) {
  const { batchId } = await params
  const data = load(batchId)
  if (!data) notFound()

  const { batch, work, results, specimen, specimenProblem, reconciliation } = data
  const meta = catalogue()
  const byId = new Map(results.map(r => [r.id, r]))
  const totalOps = results.reduce((sum, r) => sum + (Number.isFinite(r.ops) ? r.ops : 0), 0)

  const planned = work?.order.operators ?? []
  const enabled = planned.filter(o => o.enabled)
  const disabled = planned.filter(o => !o.enabled)
  const noResult = enabled.filter(o => !byId.has(o.id))
  const unplanned = results.filter(r => !planned.some(o => o.id === r.id))
  const logged = [...enabled.filter(o => byId.has(o.id)).map(o => byId.get(o.id) as OperatorResult), ...unplanned]

  const evidence: (Evidence & { operatorId: string })[] = results.flatMap(r =>
    (r.evidence ?? []).map(e => ({ ...e, operatorId: r.id })),
  )

  let png: Uint8Array | null = specimen?.png ?? null
  let pngProblem: string | null = null
  if (!png && specimen) {
    try {
      png = encodePng(renderSpecimen(specimen.params, DEFAULT_SIZE), DEFAULT_SIZE, specimen.params.palette)
    } catch (error) {
      pngProblem = String(error instanceof Error ? error.message : error)
    }
  }
  const pngUrl = png ? pngDataUrl(png) : null

  return (
    <main className="certificate mx-auto w-full max-w-4xl px-6 py-10">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <header className="row-in flex flex-wrap items-end justify-between gap-6 border-b border-rule-bright pb-4">
        <div>
          <div className="text-[26px] leading-none tracking-[0.34em]">DOXA</div>
          <div className="mt-2 tracking-[0.2em] text-ink-dim uppercase">Certificate of analysis</div>
        </div>
        <dl className="space-y-1 text-right">
          <div>
            <span className="text-ink-faint">batch </span>
            <span>{batch.id}</span>
          </div>
          <div>
            <span className="text-ink-faint">opened </span>
            <span>{batch.createdAt}</span>
          </div>
          <div>
            <span className="text-ink-faint">operations </span>
            <span>{totalOps.toLocaleString('en-US')}</span>
          </div>
        </dl>
      </header>

      <Section index="01" title="The opinion" order={0} note={`${batch.opinion.length} characters`}>
        <blockquote className="prose-sans border-l-2 border-signal pl-4 whitespace-pre-wrap">
          {batch.opinion}
        </blockquote>
      </Section>

      <Section
        index="02"
        title="The work order"
        order={1}
        note={work?.signedAt ? `signed ${work.signedAt}` : 'not signed'}
      >
        {!work ? (
          <p>
            <Absent>
              No work order was written for this batch, so nothing here was planned or signed.
            </Absent>
          </p>
        ) : (
          <>
            <dl className="space-y-1">
              <Field label="Signed">
                {work.signedAt ? (
                  work.signedAt
                ) : (
                  <Absent>not signed. This batch ran without a human approving the plan.</Absent>
                )}
              </Field>
              <Field label="Composed">{work.order.createdAt}</Field>
              <Field label="Estimate">
                {work.order.estCostUnits} cost units, {work.order.estMs} ms,{' '}
                {work.order.estOps.toLocaleString('en-US')} operations
              </Field>
              <Field label="Performed">
                {totalOps.toLocaleString('en-US')} operations across {results.length} operators
              </Field>
              <Field label="Planner">
                {work.order.plannerNotes?.trim() ? (
                  <span className="prose-sans">{work.order.plannerNotes}</span>
                ) : (
                  <Absent>no planner notes recorded</Absent>
                )}
              </Field>
            </dl>

            <table className="mt-4 w-full border-collapse text-left">
              <thead className="text-ink-faint">
                <tr className="border-b border-rule">
                  <th className="py-1 pr-3 font-normal">Operator</th>
                  <th className="py-1 pr-3 font-normal">In the run</th>
                  <th className="py-1 font-normal">Why the planner asked for it</th>
                </tr>
              </thead>
              <tbody>
                {planned.map(entry => (
                  <tr key={entry.id} className="keep-together border-b border-rule align-top">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{entry.id}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {entry.enabled ? 'enabled' : <Absent>switched off at the gate</Absent>}
                    </td>
                    <td className="prose-sans py-1.5">{entry.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="mt-3 text-ink-dim">
              {enabled.length} of {planned.length} operators were enabled.{' '}
              {disabled.length > 0
                ? `${disabled.length} were switched off by the person who signed.`
                : 'Nothing was switched off.'}
            </p>
          </>
        )}
      </Section>

      <Section index="03" title="Operations" order={2} note={`${logged.length} operators reported`}>
        {logged.length === 0 ? (
          <p>
            <Absent>No operator result was written for this batch. The run did not report.</Absent>
          </p>
        ) : (
          <div className="space-y-5">
            {logged.map(result => {
              const op = meta.get(result.id)
              const trace = traceIdOf(result)
              const ms = durationOf(result)
              const readings = Object.entries(result.readings)
              return (
                <article key={result.id} className="keep-together border-t border-rule pt-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h3 className="tracking-[0.1em]">{result.id}</h3>
                    <span className="text-ink-dim">
                      {result.ops.toLocaleString('en-US')} operations
                    </span>
                  </div>
                  {op ? (
                    <p className="prose-sans mt-0.5 text-ink-dim">
                      {op.name}. {op.wing} wing. {op.blurb}
                    </p>
                  ) : null}

                  <dl className="mt-2 space-y-1">
                    <Field label="Inputs">
                      the opinion ({batch.opinion.length} characters)
                      {op && op.needs.length > 0 ? `, and the results of ${op.needs.join(', ')}` : ''}
                    </Field>
                    <Field label="Outputs">
                      {readings.length === 0 ? (
                        <Absent>no readings recorded</Absent>
                      ) : (
                        readings.map(([key, value], i) => (
                          <span key={key}>
                            {i > 0 ? ' . ' : ''}
                            <span className="text-ink-faint">{key} </span>
                            {formatValue(value)}
                          </span>
                        ))
                      )}
                    </Field>
                    <Field label="Wrote">
                      {(result.contributions ?? []).length === 0 ? (
                        <Absent>nothing. This operator shaped no part of the specimen.</Absent>
                      ) : (
                        (result.contributions ?? []).map((c, i) => (
                          <span key={`${c.path}-${i}`}>
                            {i > 0 ? ' . ' : ''}
                            {c.path} = {formatValue(c.value)}{' '}
                            <span className="text-ink-faint">at weight {c.weight.toFixed(2)}</span>
                          </span>
                        ))
                      )}
                    </Field>
                    <Field label="Duration">
                      {ms !== null ? (
                        `${ms} ms`
                      ) : (
                        <Absent>
                          not recorded. The executor times every operator for the live floor, and the
                          stored result does not carry that timing.
                        </Absent>
                      )}
                    </Field>
                    <Field label="Trace">
                      {trace ? (
                        <span className="break-all">{trace}</span>
                      ) : (
                        <Absent>
                          no SigNoz trace id recorded for this operator.
                        </Absent>
                      )}
                    </Field>
                    {(result.notes ?? []).length > 0 ? (
                      <Field label="Notes">
                        <ul className="prose-sans list-disc pl-4">
                          {(result.notes ?? []).map((note, i) => (
                            <li key={i}>{note}</li>
                          ))}
                        </ul>
                      </Field>
                    ) : null}
                  </dl>
                </article>
              )
            })}
          </div>
        )}

        {noResult.length > 0 ? (
          <p className="mt-4 border-t border-rule pt-3">
            <Absent>
              {noResult.length} enabled {noResult.length === 1 ? 'operator' : 'operators'} wrote no
              result: {noResult.map(o => o.id).join(', ')}. Each one failed, or was skipped because
              something it needed failed.
            </Absent>
          </p>
        ) : null}
      </Section>

      <Section index="04" title="Field evidence" order={3} note={`${evidence.length} items`}>
        {evidence.length === 0 ? (
          <p>
            <Absent>
              No outside evidence was collected for this batch. Either no field operator ran, or the
              ones that ran returned nothing that passed the schema gate.
            </Absent>
          </p>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead className="text-ink-faint">
              <tr className="border-b border-rule">
                <th className="py-1 pr-3 font-normal">Operator</th>
                <th className="py-1 pr-3 font-normal">Source</th>
                <th className="py-1 pr-3 font-normal">Retrieved</th>
                <th className="py-1 font-normal">Reads</th>
              </tr>
            </thead>
            <tbody>
              {evidence.map((item, i) => (
                <tr key={`${item.operatorId}-${i}`} className="keep-together border-b border-rule align-top">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{item.operatorId}</td>
                  <td className="py-1.5 pr-3">
                    <div>{item.source}</div>
                    <a
                      href={item.url}
                      className="break-all text-ink-faint underline decoration-dotted underline-offset-2"
                    >
                      {item.url}
                    </a>
                    <div className="prose-sans mt-1 text-ink-dim">{item.snippet}</div>
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{item.retrievedAt}</td>
                  <td className="py-1.5 whitespace-nowrap">
                    {item.supports ? 'holds up' : 'cuts against'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section index="05" title="Reconciliation" order={4}>
        {reconciliation ? (
          <p className="prose-sans max-w-2xl">{reconciliation}</p>
        ) : (
          <p>
            <Absent>
              The reconciliation stage has not run for this batch, so there is no paragraph to print.
              The readings above are the whole of what was measured.
            </Absent>
          </p>
        )}
      </Section>

      <Section
        index="06"
        title="The specimen"
        order={5}
        note={specimen ? `seed ${specimen.params.seed}` : undefined}
      >
        {!specimen ? (
          <p>
            <Absent>
              No specimen was struck for this batch.{' '}
              {specimenProblem
                ? `The stored row could not be read: ${specimenProblem}.`
                : 'The merge never wrote one, which happens when an operator failed and left a render parameter with no contribution.'}
            </Absent>
          </p>
        ) : (
          <div className="flex flex-col gap-8">
            <div className="max-w-[512px]">
              <Specimen params={specimen.params} attribution={specimen.attribution} />
              {pngUrl ? (
                <img
                  src={pngUrl}
                  alt={`The specimen struck for batch ${batch.id}`}
                  className="specimen-print hidden border border-rule"
                />
              ) : null}
              <p className="mt-2 text-ink-faint print:hidden">
                Hover the specimen to read which assay shaped the pixel under the pointer.
              </p>
              {/* Back to where this specimen sits among the others. The certificate is the
                  end of one run, not the end of the product, and without this the only way
                  back to the graph is the browser button. */}
              <p className="mt-1 print:hidden">
                <a
                  href={`/graph?open=${batch.id}`}
                  className="text-signal underline decoration-dotted underline-offset-2"
                >
                  See this opinion in the graph
                </a>
              </p>
              <p className="mt-1">
                {pngUrl && png ? (
                  <a
                    href={pngUrl}
                    download={`doxa-${batch.id}.png`}
                    className="text-signal underline decoration-dotted underline-offset-2 print:hidden"
                  >
                    Download the PNG ({DEFAULT_SIZE} by {DEFAULT_SIZE}, {Math.ceil(png.length / 1024)} kB)
                  </a>
                ) : (
                  <Absent>
                    The PNG could not be struck from the stored parameters
                    {pngProblem ? `: ${pngProblem}` : '.'}
                  </Absent>
                )}
              </p>
            </div>

            <div className="min-w-0">
              <table className="w-full border-collapse text-left">
                <thead className="text-ink-faint">
                  <tr className="border-b border-rule">
                    <th className="py-1 pr-3 font-normal">Parameter</th>
                    <th className="py-1 pr-3 font-normal">Value</th>
                    <th className="py-1 font-normal">Who shaped it</th>
                  </tr>
                </thead>
                <tbody>
                  {ALL_RENDER_PATHS.map(path => {
                    const entry = specimen.attribution[path]
                    const value = valueAt(specimen.params, path)
                    return (
                      <tr key={path} className="keep-together border-b border-rule align-top">
                        <td className="py-1.5 pr-3 whitespace-nowrap">{path}</td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            {isColourPath(path) && typeof value === 'string' ? (
                              <span
                                aria-hidden
                                className="inline-block h-3 w-3 border border-rule-bright"
                                style={{ backgroundColor: value }}
                              />
                            ) : null}
                            {formatValue(value)}
                          </span>
                        </td>
                        <td className="py-1.5">
                          {!entry ? (
                            <Absent>no contributor recorded</Absent>
                          ) : (
                            <>
                              <div className={MODE_CLASS[entry.mode] ?? 'text-ink-faint'}>
                                {entry.mode === 'sole'
                                  ? 'sole'
                                  : entry.mode === 'contested'
                                    ? `contested, taken whole from ${entry.dominant}`
                                    : `blended from ${entry.contributors.length} assays`}
                              </div>
                              <ul>
                                {entry.contributors.map((c, i) => (
                                  <li key={`${c.operatorId}-${i}`}>
                                    {c.operatorId}{' '}
                                    <span className="text-ink-dim">{formatValue(c.value)}</span>{' '}
                                    <span className="text-ink-faint">
                                      at weight {c.weight.toFixed(2)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="mt-3 text-ink-dim">
                A blended parameter is a weighted mean of every value listed under it, so no single
                assay produced it. A contested parameter went whole to the heaviest claim.
              </p>
            </div>
          </div>
        )}
      </Section>

      {/* The certificate is the end of one run and the product is the loop, so the page
          closes with the one thing there is left to do. It is hidden in print: a printed
          certificate is a record, and a record does not ask the reader for anything. */}
      <div className="mt-10 flex items-center gap-5 print:hidden">
        <Link className="gate-sign" href="/">
          PUT ANOTHER OPINION THROUGH
        </Link>
        <span className="prose-sans text-[12.5px] text-ink-faint">
          Every reading here came from your sentence and nobody else&apos;s.
        </span>
      </div>

      <footer className="mt-12 border-t border-rule-bright pt-3 text-ink-faint">
        <p>
          Struck by DOXA for batch {batch.id}. Every reading on this page comes from the run that
          produced it. The specimen is a function of the parameters above and the seed, so the same
          work order strikes the same specimen again.
        </p>
      </footer>
    </main>
  )
}
