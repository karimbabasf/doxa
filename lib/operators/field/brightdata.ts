import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/**
 * The only place this codebase talks to Bright Data.
 *
 * It drives the `bdata` CLI rather than an HTTP API on purpose: `scraper heal` is a CLI
 * verb, the judging hook is that verb running on camera against the same collector id,
 * and its stdout is the heal diff the floor screen renders while the repair path waits.
 *
 * Every test in this wing mocks this module. Nothing here is exercised without a real
 * Bright Data session, so it stays small and does no parsing it can avoid.
 */

const run = promisify(execFile)

/** Collector ids, pinned in CLAUDE.md. Env wins so a rebuilt collector needs no code change. */
export const CORROBORATE_COLLECTOR = process.env.BRIGHTDATA_CORROBORATE_ID || 'c_mt12stqk2d78cqkmn2'
export const PRIOR_ART_COLLECTOR = process.env.BRIGHTDATA_PRIOR_ART_ID || 'c_mt12spi4173gff7wai'

/** A scrape of 250 rows is normal and a cold collector is slow, so the default is generous. */
const DEFAULT_TIMEOUT_MS = 180_000
const MAX_BUFFER = 64 * 1024 * 1024

function cli(): { command: string; prefix: string[] } {
  // The local binary, not `npx -p @brightdata/cli`, which re-resolves the package on every
  // call and adds seconds to an operator that is already the slowest in the library.
  const raw = (process.env.BRIGHTDATA_CLI || './node_modules/.bin/bdata').trim().split(/\s+/)
  return { command: raw[0], prefix: raw.slice(1) }
}

function timeoutMs(): number {
  const raw = Number(process.env.BRIGHTDATA_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS
}

async function bdata(args: string[]): Promise<string> {
  const { command, prefix } = cli()
  try {
    const { stdout } = await run(command, [...prefix, ...args], {
      timeout: timeoutMs(),
      maxBuffer: MAX_BUFFER,
    })
    return stdout
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    const detail = (e.stderr || e.message || '').toString().trim().slice(0, 500)
    throw new Error(`bdata ${args.join(' ')} failed: ${detail}`)
  }
}

/**
 * The CLI prints progress lines before the payload, so the JSON is cut out rather than
 * assumed to start at byte zero.
 */
function parseRows(stdout: string, collectorId: string): unknown[] {
  const text = stdout.trim()
  const start = text.search(/[[{]/)
  if (start === -1) {
    throw new Error(`Scraper ${collectorId} returned no JSON. Output began: ${text.slice(0, 200)}`)
  }
  const open = text[start]
  const end = text.lastIndexOf(open === '[' ? ']' : '}')
  const slice = end > start ? text.slice(start, end + 1) : text.slice(start)

  let parsed: unknown
  try {
    parsed = JSON.parse(slice)
  } catch {
    throw new Error(`Scraper ${collectorId} returned output that is not JSON: ${slice.slice(0, 200)}`)
  }

  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    const box = parsed as Record<string, unknown>
    for (const key of ['data', 'results', 'rows', 'items']) {
      if (Array.isArray(box[key])) return box[key] as unknown[]
    }
    // One row returned bare rather than wrapped in an array.
    return [parsed]
  }
  throw new Error(`Scraper ${collectorId} returned ${typeof parsed}, expected an array of rows`)
}

/**
 * Collector inputs in this build are a single target URL. The key is named so callers
 * read as `{ url }`, and a single-key input of any other name still works, because the
 * demo collector may name its input something else.
 */
function targetOf(input: Record<string, string>, collectorId: string): string {
  if (typeof input.url === 'string' && input.url.length > 0) return input.url
  const keys = Object.keys(input)
  if (keys.length === 1 && input[keys[0]]) return input[keys[0]]
  throw new Error(
    `Scraper ${collectorId} needs one target, got input keys [${keys.join(', ')}]. Pass { url }.`,
  )
}

/** Run a pinned collector against one input and hand back its rows, unvalidated. */
export async function triggerCollector(
  collectorId: string,
  input: Record<string, string>,
): Promise<unknown[]> {
  const stdout = await bdata(['scraper', 'run', collectorId, targetOf(input, collectorId), '--pretty'])
  return parseRows(stdout, collectorId)
}

/**
 * One repair attempt on a collector, told exactly why the last scrape failed the gate.
 * Returns the heal diff so the floor screen has something real to show during the wait.
 *
 * The approve step is part of the heal, not downstream work: on 2026-08-20 an unapproved
 * heal left production serving the old selectors, so the re-scrape that follows this call
 * would have read stale output and the loop would have blamed the healer for a step it was
 * never given.
 *
 * Set BRIGHTDATA_HEAL_NO_REASON=1 if the installed CLI rejects the positional reason. The
 * reason still comes back in the returned diff either way.
 */
export async function healCollector(collectorId: string, why: string): Promise<string> {
  const withReason = process.env.BRIGHTDATA_HEAL_NO_REASON !== '1'
  const args = withReason ? ['scraper', 'heal', collectorId, why] : ['scraper', 'heal', collectorId]
  const diff = (await bdata(args)).trim()
  await bdata(['scraper', 'approve', collectorId])
  return `heal ${collectorId}, told: ${why}\n${diff}`
}
