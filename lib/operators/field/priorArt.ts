import { register } from '../registry'
import { embed } from '../../llm'
import { cosine } from '../semantics/embed'
import { PRIOR_ART_COLLECTOR } from './brightdata'
import { fetchWithRepair, type Row } from './schema'
import { WING_WEIGHT, type Evidence, type Operator } from '../../types'

/**
 * Looks for the closest public statement of the same take, and reports how far the
 * opinion sits from it. A person who has just restated Arthur C. Clarke gets told so,
 * with the date.
 *
 * This is the operator that sits on the collector with the known mis-binding. It is
 * expected to fail its gate and call a human until that collector is fixed, and that is
 * correct behaviour rather than a bug to work around: 149 rows of the same wrong name
 * carrying `repaired: 'yes'` would be worse than a stopped run.
 */

/** Real Wikiquote page titles. Fixed and ordered, so routing and its verify pick stay deterministic. */
const TOPICS = [
  'Technology',
  'Science',
  'Art',
  'Money',
  'Health',
  'Politics',
  'Education',
  'Nature',
  'Work',
  'Truth',
] as const

/** First topic whose words appear in the claim wins. No match routes to Technology. */
const ROUTES: { topic: (typeof TOPICS)[number]; words: string[] }[] = [
  { topic: 'Money', words: ['money', 'price', 'cost', 'market', 'stock', 'fund', 'invest', 'salary', 'wealth', 'tax', 'economy'] },
  { topic: 'Science', words: ['science', 'research', 'study', 'physics', 'biology', 'chemistry', 'experiment', 'evidence'] },
  { topic: 'Art', words: ['art', 'music', 'film', 'painting', 'design', 'novel', 'poetry', 'beauty', 'writing'] },
  { topic: 'Health', words: ['health', 'diet', 'sleep', 'exercise', 'medicine', 'doctor', 'illness', 'mental'] },
  { topic: 'Politics', words: ['politics', 'government', 'election', 'law', 'policy', 'democracy', 'vote', 'state'] },
  { topic: 'Education', words: ['education', 'school', 'teacher', 'student', 'learning', 'university', 'degree'] },
  { topic: 'Nature', words: ['nature', 'climate', 'animal', 'forest', 'ocean', 'earth', 'environment', 'planet'] },
  { topic: 'Work', words: ['work', 'job', 'career', 'office', 'employer', 'labour', 'labor', 'remote', 'hiring'] },
  { topic: 'Truth', words: ['truth', 'lie', 'honest', 'belief', 'fact', 'opinion', 'reality'] },
]

/** The collector's real field names. `source_note` is read but not declared: it came back on
 *  140 of 149 real rows, so it is good enough to quote and not good enough to gate on. */
const FIELDS = ['quote_text', 'attributed_to', 'section_heading']
const MUST_VARY = ['quote_text', 'attributed_to']

/** One embedding call, so a 149 quotation page does not turn into a 149 request fan-out. */
const MAX_CANDIDATES = 80

/** An original take earns more marks on the specimen than a rehash. */
const MIN_PRIMITIVES = 8
const MAX_PRIMITIVES = 64

function routeTopic(text: string): (typeof TOPICS)[number] {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  for (const route of ROUTES) {
    if (route.words.some(word => haystack.includes(` ${word}`))) return route.topic
  }
  return 'Technology'
}

/** The topic after the routed one, wrapping. Never the topic we scraped, so the proof is real. */
function verifyTopic(topic: (typeof TOPICS)[number]): (typeof TOPICS)[number] {
  return TOPICS[(TOPICS.indexOf(topic) + 1) % TOPICS.length]
}

const topicUrl = (topic: string) => `https://en.wikiquote.org/wiki/${topic}`

/**
 * PRIOR-ART returns one row per page with the quotations nested under it, whatever the
 * build description asked for. A row that already looks flat passes through untouched, so
 * the same operator survives a collector rebuilt to the other convention.
 */
function flattenQuotations(rows: unknown[]): unknown[] {
  const out: unknown[] = []
  for (const raw of rows) {
    if (raw === null || typeof raw !== 'object') {
      out.push(raw)
      continue
    }
    const page = raw as Record<string, unknown>
    if (!Array.isArray(page.quotations)) {
      out.push(raw)
      continue
    }
    const pageUrl =
      (typeof page.product_page_url === 'string' && page.product_page_url) ||
      (typeof (page.input as { url?: string })?.url === 'string' && (page.input as { url: string }).url) ||
      ''
    for (const quotation of page.quotations) {
      if (quotation === null || typeof quotation !== 'object') {
        out.push(quotation)
        continue
      }
      out.push({ ...(quotation as Record<string, unknown>), product_page_url: pageUrl })
    }
  }
  return out
}

/** A four digit year out of a source note like "Profiles of the Future (1962)". */
function yearOf(sourceNote: string): string {
  const match = sourceNote.match(/\b(1[0-9]{3}|20[0-9]{2})\b/)
  return match ? match[1] : 'unknown'
}

export const PRIOR_ART: Operator = {
  id: 'PRIOR-ART',
  name: 'Prior art search',
  wing: 'field',
  blurb: 'Finds the closest published version of the same take, and dates it.',
  needs: ['CLAIM-EX'],
  costUnits: 20,
  estMs: 120_000,
  estOps: 300,
  touches: ['primitives.count'],
  async run(ctx) {
    const claimResult = ctx.results.get('CLAIM-EX')
    if (!claimResult) {
      throw new Error('PRIOR-ART needs CLAIM-EX to have run first, and it has no claim to place.')
    }
    const claim = String(claimResult.readings.claim ?? '')
    const subject = String(claimResult.readings.subject ?? '')

    const topic = routeTopic(`${subject} ${claim}`)
    const verify = verifyTopic(topic)
    const retrievedAt = new Date().toISOString()

    const scrape = await fetchWithRepair(
      PRIOR_ART_COLLECTOR,
      { url: topicUrl(topic) },
      { url: topicUrl(verify) },
      FIELDS,
      { mustVary: MUST_VARY, flatten: flattenQuotations },
    )

    const candidates: Row[] = scrape.rows.slice(0, MAX_CANDIDATES)
    const vectors = await embed([claim, ...candidates.map(row => row.quote_text)])
    const claimVector = vectors[0]

    let best = -1
    let bestRow: Row | undefined
    for (let i = 0; i < candidates.length; i++) {
      const vector = vectors[i + 1]
      if (!Array.isArray(vector)) continue
      const similarity = cosine(claimVector, vector)
      if (similarity > best) {
        best = similarity
        bestRow = candidates[i]
      }
    }

    // Cosine runs to minus one on opposed vectors, and originality is a zero to one reading.
    const originality = Math.min(1, Math.max(0, 1 - Math.max(0, best)))
    const closestSource = bestRow?.attributed_to || 'unknown'
    const closestDate = yearOf(bestRow?.source_note || '')

    const evidence: Evidence[] = bestRow
      ? [
          {
            source: `Wikiquote: ${topic}, attributed to ${closestSource}`,
            url: bestRow.product_page_url || topicUrl(topic),
            snippet: bestRow.quote_text,
            retrievedAt,
            // The closest published statement supports the reading that the take is not new.
            supports: best >= 0.5,
          },
        ]
      : []

    return {
      id: 'PRIOR-ART',
      // Every quotation read, plus every vector compared.
      ops: scrape.rows.length + candidates.length,
      readings: {
        originality,
        closestDate,
        closestSource,
        quotationsRead: scrape.rows.length,
        // readings holds scalars only, so the boolean lands as a word.
        repaired: scrape.repaired ? 'yes' : 'no',
      },
      evidence,
      contributions: [
        {
          path: 'primitives.count',
          value: Math.round(MIN_PRIMITIVES + originality * (MAX_PRIMITIVES - MIN_PRIMITIVES)),
          weight: WING_WEIGHT.field * 0.8,
        },
      ],
      notes: scrape.healDiff
        ? [`collector healed and re-proved on ${verify}`, scrape.healDiff]
        : undefined,
    }
  },
}

register(PRIOR_ART)
