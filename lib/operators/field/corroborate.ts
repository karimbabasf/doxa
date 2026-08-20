import { register } from '../registry'
import { chatJson } from '../../llm'
import { CORROBORATE_COLLECTOR } from './brightdata'
import { fetchWithRepair, type Row } from './schema'
import { WING_WEIGHT, type Evidence, type Operator } from '../../types'

/**
 * Takes the claim CLAIM-EX pulled out of the opinion and goes looking for people who
 * already argued about it, on a forum small enough that nobody has a pre-built scraper
 * pointed at it. Every row it reads has passed the schema gate, and if the collector had
 * to be healed to produce them, the heal was proved on a group this run never scraped.
 *
 * The field names below are the ones the collector really returns. See CLAUDE.md: a check
 * against an invented field name produces a failure no healer can fix.
 */

/** Real Tildes groups. Fixed and ordered, so routing and its verify pick stay deterministic. */
const GROUPS = [
  'tech',
  'comp',
  'science',
  'news',
  'finance',
  'design',
  'games',
  'books',
  'health',
  'enviro',
] as const

/** First group whose words appear in the claim wins. No match routes to ~tech. */
const ROUTES: { group: (typeof GROUPS)[number]; words: string[] }[] = [
  { group: 'comp', words: ['code', 'coding', 'language', 'compiler', 'rust', 'python', 'javascript', 'typescript', 'framework', 'programming', 'developer', 'engineer', 'software'] },
  { group: 'finance', words: ['fund', 'stock', 'market', 'price', 'invest', 'economy', 'inflation', 'tax', 'salary', 'money', 'crypto', 'bank'] },
  { group: 'science', words: ['study', 'research', 'physics', 'biology', 'chemistry', 'scientist', 'experiment', 'data'] },
  { group: 'enviro', words: ['climate', 'solar', 'carbon', 'energy', 'nuclear', 'emission', 'wind', 'environment'] },
  { group: 'health', words: ['health', 'diet', 'sleep', 'exercise', 'doctor', 'medicine', 'mental'] },
  { group: 'books', words: ['book', 'novel', 'author', 'reading', 'writer', 'publishing'] },
  { group: 'games', words: ['game', 'gaming', 'console', 'player', 'nintendo', 'steam'] },
  { group: 'design', words: ['design', 'typography', 'ux', 'interface', 'font', 'layout'] },
  { group: 'news', words: ['election', 'government', 'policy', 'court', 'law', 'president', 'war'] },
]

/** The collector's real field names. `group` is here to prove which group we read, and it is
 *  deliberately not in mustVary: one group scraped means one constant value, correctly. */
const FIELDS = ['title', 'topic_url', 'group', 'posted_at']
const MUST_VARY = ['title', 'topic_url']

/** One labelling call, so the prompt stays inside a sane size on a 250 row scrape. */
const MAX_LABELLED = 24

/** A balanced sweep is still a real reading, so the claim on palette.ground never falls to zero.
 *  mergeContributions throws on a path claimed only at zero weight, and that would lose the specimen. */
const MIN_WEIGHT = 0.05

const GROUND_DARK = { r: 0x17, g: 0x15, b: 0x12 }
const GROUND_LIGHT = { r: 0xf4, g: 0xf1, b: 0xea }

const SYSTEM = [
  'You read titles of discussion threads from one forum and one claim.',
  'For each numbered title, decide whether the discussion it names supports the claim or works against it.',
  'Supports means the title points the same way as the claim. Anything else, including a title',
  'that argues the other way and a title that is merely on the topic, is not support.',
  'Return one entry per numbered title, using the number you were given.',
].join(' ')

const SCHEMA = {
  type: 'object',
  properties: {
    labels: {
      type: 'array',
      items: {
        type: 'object',
        properties: { index: { type: 'integer' }, supports: { type: 'boolean' } },
        required: ['index', 'supports'],
        additionalProperties: false,
      },
    },
  },
  required: ['labels'],
  additionalProperties: false,
}

type LabelOut = { labels: { index: number; supports: boolean }[] }

function routeGroup(text: string): (typeof GROUPS)[number] {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  for (const route of ROUTES) {
    if (route.words.some(word => haystack.includes(` ${word}`))) return route.group
  }
  return 'tech'
}

/** The group after the routed one, wrapping. Never the group we scraped, so the proof is real. */
function verifyGroup(group: (typeof GROUPS)[number]): (typeof GROUPS)[number] {
  return GROUPS[(GROUPS.indexOf(group) + 1) % GROUPS.length]
}

const groupUrl = (group: string) => `https://tildes.net/~${group}`

/** Well supported reads as a lighter ground, contradicted as a darker one. */
function groundFor(score: number): string {
  const t = Math.min(1, Math.max(0, (score + 1) / 2))
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t)
  const hex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${hex(mix(GROUND_DARK.r, GROUND_LIGHT.r))}${hex(mix(GROUND_DARK.g, GROUND_LIGHT.g))}${hex(mix(GROUND_DARK.b, GROUND_LIGHT.b))}`
}

async function labelRows(claim: string, rows: Row[]): Promise<Map<number, boolean>> {
  const listing = rows.map((row, i) => `${i}. ${row.title}`).join('\n')
  const out = await chatJson<LabelOut>({
    system: SYSTEM,
    user: `Claim:\n${claim}\n\nThread titles:\n${listing}`,
    schema: SCHEMA,
  })
  const verdicts = new Map<number, boolean>()
  for (const label of out.labels ?? []) {
    if (Number.isInteger(label.index) && label.index >= 0 && label.index < rows.length) {
      verdicts.set(label.index, label.supports === true)
    }
  }
  return verdicts
}

export const CORROBORATE: Operator = {
  id: 'CORROBORATE',
  name: 'Corroboration sweep',
  wing: 'field',
  blurb: 'Reads a forum that argued about this already and counts who lands on which side.',
  needs: ['CLAIM-EX'],
  costUnits: 20,
  estMs: 120_000,
  estOps: 500,
  touches: ['palette.ground'],
  async run(ctx) {
    const claimResult = ctx.results.get('CLAIM-EX')
    if (!claimResult) {
      throw new Error('CORROBORATE needs CLAIM-EX to have run first, and it has no claim to check.')
    }
    const claim = String(claimResult.readings.claim ?? '')
    const subject = String(claimResult.readings.subject ?? '')

    const group = routeGroup(`${subject} ${claim}`)
    const verify = verifyGroup(group)
    const retrievedAt = new Date().toISOString()

    const scrape = await fetchWithRepair(
      CORROBORATE_COLLECTOR,
      { url: groupUrl(group) },
      { url: groupUrl(verify) },
      FIELDS,
      { mustVary: MUST_VARY },
    )

    const considered = scrape.rows.slice(0, MAX_LABELLED)
    const verdicts = await labelRows(claim, considered)

    const evidence: Evidence[] = []
    for (const [index, supports] of [...verdicts.entries()].sort((a, b) => a[0] - b[0])) {
      const row = considered[index]
      evidence.push({
        source: `Tildes ~${row.group || group}`,
        url: row.topic_url,
        snippet: row.title,
        retrievedAt,
        supports,
      })
    }

    const supporting = evidence.filter(e => e.supports).length
    const contradicting = evidence.length - supporting
    const corroborationScore = evidence.length === 0 ? 0 : (supporting - contradicting) / evidence.length

    return {
      id: 'CORROBORATE',
      // Every row read, plus every row judged.
      ops: scrape.rows.length + evidence.length,
      readings: {
        corroborationScore,
        sourcesChecked: evidence.length,
        // readings holds scalars only, so the boolean lands as a word.
        repaired: scrape.repaired ? 'yes' : 'no',
        group: `~${group}`,
      },
      evidence,
      contributions: [
        {
          path: 'palette.ground',
          value: groundFor(corroborationScore),
          weight: Math.max(MIN_WEIGHT, WING_WEIGHT.field * Math.abs(corroborationScore)),
        },
      ],
      notes: scrape.healDiff ? [`collector healed and re-proved on ~${verify}`, scrape.healDiff] : undefined,
    }
  },
}

register(CORROBORATE)
