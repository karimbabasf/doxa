/**
 * The schema gate. Everything the field wing scrapes passes through here before any
 * operator is allowed to read it.
 *
 * It checks three conditions, not one, and the third is the expensive lesson. On
 * 2026-08-20 the Wikiquote collector returned 149 rows with `attributed_to` filled on
 * every single one and set to the same wrong name on every single one, because the field
 * bound to a page-level element instead of each quotation's own citation. A presence
 * check passes that. An emptiness check passes that too. Only comparing values across
 * rows catches it, and a mis-bound selector is the most likely way a scraper or a heal
 * goes wrong.
 *
 * Condition three is opt-in per field because some fields are legitimately constant. The
 * same day's Tildes run returned 250 clean rows with `group` = "tech" on every one,
 * correctly, because we scraped a single group. Gating every field would have failed a
 * perfect scrape.
 */

import { triggerCollector, healCollector } from './brightdata'

export type Row = Record<string, string>

export type CheckOpts = {
  /** Fields whose whole purpose is to differ per row. Only these get the identical-value check. */
  mustVary?: string[]
}

export type RepairOpts = CheckOpts & {
  /**
   * Reshape a collector's raw output into one row per record before validating. PRIOR-ART
   * returns one row per page with the quotations nested inside it; CORROBORATE returns one
   * flat row per topic. The hook runs on every attempt, the verify scrape included, so a
   * nested collector cannot skip the gate on the one scrape that proves the repair held.
   */
  flatten?: (rows: unknown[]) => unknown[]
}

export type CheckResult = { ok: true; rows: Row[] } | { ok: false; reason: string }

/** Rows arrive shaped by the collector, so scalars are coerced and nested values are kept as JSON. */
function asCell(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }
  return ''
}

function normalise(rows: unknown[]): { rows: Row[] } | { reason: string } {
  const out: Row[] = []
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { reason: `row ${i} is not an object, it is ${JSON.stringify(raw)?.slice(0, 60)}` }
    }
    const row: Row = {}
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      row[key] = asCell(value)
    }
    out.push(row)
  }
  return { rows: out }
}

/**
 * Validate a scrape against the fields the caller declared. The declared names must be
 * names the collector really returns: see CLAUDE.md. A check against a field the scraper
 * was never asked to collect produces a failure no amount of healing can fix, because the
 * scraper is doing what it was told and the check is the thing that is wrong.
 */
export function checkRows(rows: unknown[], fields: string[], opts?: CheckOpts): CheckResult {
  const mustVary = opts?.mustVary ?? []

  const undeclared = mustVary.filter(f => !fields.includes(f))
  if (undeclared.length > 0) {
    return {
      ok: false,
      reason:
        `mustVary names ${undeclared.map(f => `"${f}"`).join(', ')}, which ` +
        `${undeclared.length === 1 ? 'is not a' : 'are not'} declared field${undeclared.length === 1 ? '' : 's'}. ` +
        `Declared fields are ${fields.map(f => `"${f}"`).join(', ')}.`,
    }
  }

  if (rows.length === 0) {
    return { ok: false, reason: `the scraper returned 0 rows, so there is nothing to validate` }
  }

  const shaped = normalise(rows)
  if ('reason' in shaped) return { ok: false, reason: shaped.reason }
  const table = shaped.rows

  // 1. Every declared field is present on every row.
  const missing: string[] = []
  for (const field of fields) {
    const absent = table.filter(row => !(field in row)).length
    if (absent > 0) missing.push(`"${field}" is missing from ${absent} of ${table.length} rows`)
  }
  if (missing.length > 0) {
    return { ok: false, reason: `the scrape is missing declared fields: ${missing.join('; ')}` }
  }

  // 2. No declared field is empty on every row. Partial blanks are fine: `source_note` came
  //    back on 140 of 149 real rows and that scrape was good.
  for (const field of fields) {
    const filled = table.filter(row => row[field].trim() !== '').length
    if (filled === 0) {
      return {
        ok: false,
        reason:
          `field "${field}" is present but empty on every one of ${table.length} rows, ` +
          `so the selector matches an element that carries no text`,
      }
    }
  }

  // 3. A must-vary field does not hold one identical value across every row. This is the
  //    mis-bound selector check, and it needs more than one row to mean anything.
  if (table.length > 1) {
    for (const field of mustVary) {
      const values = new Set(table.map(row => row[field]))
      if (values.size === 1) {
        const only = table[0][field]
        return {
          ok: false,
          reason:
            `field "${field}" holds the identical value "${only.slice(0, 80)}" on all ${table.length} rows, ` +
            `so it is bound to one page-level element instead of to each row`,
        }
      }
    }
  }

  return { ok: true, rows: table }
}

/**
 * Scrape, gate, and if the gate fails, repair exactly once and then prove it twice.
 *
 * `verifyInput` is required, not optional. It names a second input this run has not
 * scraped, and it is the only thing that separates a real fix from a cache. On 2026-08-20
 * a heal reported success, showed a correct preview, `approve` returned `status: done`,
 * and production served the same wrong author on all 149 rows. One re-scrape of the
 * original input would have called that repaired. Scraping a page the run had never
 * touched is what caught it.
 *
 * Cost shape: the happy path is one scrape. The repair path is three scrapes plus a heal,
 * so it runs roughly four times longer, which is why `healDiff` comes back up to the
 * executor: the floor screen needs something real to render during the wait.
 */
export async function fetchWithRepair(
  collectorId: string,
  input: Record<string, string>,
  verifyInput: Record<string, string>,
  fields: string[],
  opts?: RepairOpts,
): Promise<{ rows: Row[]; repaired: boolean; healDiff?: string }> {
  const shape = opts?.flatten ?? ((rows: unknown[]) => rows)

  const first = checkRows(shape(await triggerCollector(collectorId, input)), fields, opts)
  if (first.ok) return { rows: first.rows, repaired: false }

  // One repair attempt, told exactly what failed. There is never a second.
  const healDiff = await healCollector(collectorId, first.reason)

  const retry = checkRows(shape(await triggerCollector(collectorId, input)), fields, opts)
  if (!retry.ok) {
    throw new Error(
      `Scraper ${collectorId} still failing after one repair: ${retry.reason}. A human needs to look at this.`,
    )
  }

  // The heal is not believed until it holds on an input this run has not scraped.
  const proof = checkRows(shape(await triggerCollector(collectorId, verifyInput)), fields, opts)
  if (!proof.ok) {
    throw new Error(
      `Scraper ${collectorId} passed its own input after repair but failed on ${JSON.stringify(verifyInput)}: ` +
        `${proof.reason}. The repair did not generalise. A human needs to look at this.`,
    )
  }

  return { rows: retry.rows, repaired: true, healDiff }
}
