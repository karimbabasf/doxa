import { chatJson } from '../llm'
import { allOperators, getOperator, resolveDeps } from '../operators/registry'
import { ALL_RENDER_PATHS, type Operator, type RenderPath, type WorkOrder } from '../types'
import { layerOps, validateWorkOrder } from './validate'

/**
 * The planner composes one pipeline for one opinion. It is the reason two people
 * typing two different takes get two visibly different factory lines: the model
 * chooses instruments against a reading of the text in front of it, and the
 * catalogue it chooses from is the live registry, not a list written by hand.
 *
 * The model never supplies a number. Cost, time and operation counts are summed
 * from what the operators declare, because an estimate the model invented is a
 * guess printed next to real measurements.
 */

type Pick = { id: string; rationale: string }
type PlannerAnswer = { picks: Pick[]; notes: string }

const PICK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['picks', 'notes'],
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'rationale'],
        properties: { id: { type: 'string' }, rationale: { type: 'string' } },
      },
    },
    notes: { type: 'string' },
  },
}

const HEDGES = [
  'maybe', 'might', 'perhaps', 'seems', 'seem', 'arguably', 'probably', 'possibly',
  'somewhat', 'fairly', 'i think', 'i feel', 'kind of', 'sort of', 'more or less',
]
const ABSOLUTES = [
  'always', 'never', 'everyone', 'everybody', 'nobody', 'no one', 'every', 'all',
  'must', 'obviously', 'undeniably', 'clearly', 'without question',
]

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0)
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Sentences, roughly. Good enough to find the words that start one. */
const sentencesOf = (text: string) =>
  text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)

function countTerms(text: string, terms: string[]): { count: number; found: string[] } {
  const lower = text.toLowerCase()
  const found: string[] = []
  let count = 0
  for (const term of terms) {
    const hits = lower.match(new RegExp(`\\b${term.replace(/ /g, '\\s+')}\\b`, 'g'))
    if (!hits) continue
    count += hits.length
    found.push(term)
  }
  return { count, found }
}

/**
 * Surface features only, computed here so the model reasons about the same text
 * the operators will. It is a reading, not a verdict: the model still decides
 * which wings earn their bench time.
 */
function readText(opinion: string) {
  const sentences = sentencesOf(opinion)
  const words = opinion.split(/\s+/).filter(Boolean)
  const longest = Math.max(0, ...sentences.map(s => s.split(/\s+/).filter(Boolean).length))
  const hedges = countTerms(opinion, HEDGES)
  const absolutes = countTerms(opinion, ABSOLUTES)

  // Capitalised words that do not start a sentence, with runs kept together so
  // "San Francisco" reads as one subject rather than two.
  const named: string[] = []
  for (const sentence of sentences) {
    let run: string[] = []
    const flush = () => {
      if (run.length) named.push(run.join(' '))
      run = []
    }
    for (const raw of sentence.split(/\s+/).slice(1)) {
      const word = raw.replace(/[^A-Za-z']/g, '')
      if (word.length > 1 && word !== 'I' && /^[A-Z]/.test(word)) run.push(word)
      else flush()
    }
    flush()
  }
  const hasDigits = /\d/.test(opinion)

  return {
    words: words.length,
    sentences: sentences.length,
    longest,
    hedges,
    absolutes,
    firstPerson: /\b(i|we|my|our|me|us)\b/i.test(opinion),
    question: opinion.includes('?'),
    hasDigits,
    named,
    checkable: hasDigits || named.length > 0,
  }
}

const yesNo = (v: boolean) => (v ? 'yes' : 'no')
const listOf = (items: string[]) => (items.length ? ` (${items.join(', ')})` : '')

function catalogue(ops: Operator[]): string {
  return ops
    .map(op => {
      const needs = op.needs.length ? op.needs.join(', ') : 'nothing'
      const blurb = /[.!?]$/.test(op.blurb.trim()) ? op.blurb.trim() : `${op.blurb.trim()}.`
      const unit = op.costUnits === 1 ? 'unit' : 'units'
      return `- ${op.id} (${op.wing} wing). ${blurb} needs: ${needs}. cost ${op.costUnits} ${unit}, about ${op.estMs} ms.`
    })
    .join('\n')
}

export function buildSystemPrompt(ops: Operator[]): string {
  return [
    'You are the shift planner of an assay line. One opinion arrives per shift. You choose which',
    'instruments run on that exact text, and you justify every choice against something you can',
    'point to in it.',
    '',
    'The instrument catalogue. Nothing outside it exists:',
    catalogue(ops),
    '',
    'Rules:',
    '1. Pick ids from the catalogue only. An id you invent is dropped and its bench time is wasted.',
    '2. Every pick carries a rationale naming the thing in the text that earns it. "It is a useful',
    '   instrument" is not a rationale. "The text hedges four times in two sentences" is.',
    '3. Skipping a whole wing is allowed and often right. A text with no checkable fact gives the',
    '   field wing nothing to do, and running it anyway spends money on a shrug.',
    '4. Do not list dependencies. An instrument that needs another one pulls it in by itself.',
    '5. Field work is the expensive half. CORROBORATE suits a claim someone could check against the',
    '   public record. PRIOR-ART suits taste and judgement, where the question is who said it first.',
    '   A text that is some of each earns both. A text that is pure feeling earns neither.',
    '6. notes is one paragraph on why this shape of line fits this text. The human who signs the',
    '   work order reads it, so write it for a person.',
  ].join('\n')
}

export function buildUserPrompt(opinion: string, rejection?: string): string {
  const r = readText(opinion)
  const lines = [
    'The opinion:',
    '"""',
    opinion,
    '"""',
    '',
    'A reading of the text, measured before you were called:',
    `- words: ${r.words}, sentences: ${r.sentences}, longest sentence: ${r.longest} words`,
    `- hedging markers: ${r.hedges.count}${listOf(r.hedges.found)}`,
    `- absolute markers: ${r.absolutes.count}${listOf(r.absolutes.found)}`,
    `- first person: ${yesNo(r.firstPerson)}`,
    `- question form: ${yesNo(r.question)}`,
    `- numbers or dates: ${yesNo(r.hasDigits)}`,
    `- named subjects: ${r.named.length}${listOf(r.named)}`,
    `- checkable detail: ${yesNo(r.checkable)}`,
    '',
    'Choose the instruments for this shift.',
  ]
  if (rejection) {
    lines.push(
      '',
      `Your last plan was rejected before it reached the human: ${rejection}`,
      'Return a plan without that problem.',
    )
  }
  return lines.join('\n')
}

/** Layers, or the set untouched if it cannot be layered. Validation reports the why. */
function safeLayers(ops: Operator[]): Operator[][] {
  try {
    return layerOps(ops)
  } catch {
    return ops.map(op => [op])
  }
}

function estimates(layers: Operator[][]) {
  const flat = layers.flat()
  return {
    estCostUnits: sum(flat.map(op => op.costUnits)),
    // Layers run concurrently, so a layer costs its slowest member, not its total.
    estMs: sum(layers.map(l => Math.max(...l.map(op => op.estMs)))),
    estOps: sum(flat.map(op => op.estOps)),
  }
}

/** Which pick dragged an unrequested operator into the run, for the gate to show. */
/**
 * Which render parameters a set of operators leaves unmeasured.
 *
 * The foundry throws rather than render a specimen part-built from defaults, which is the
 * right rule: a defaulted parameter misstates what was measured. But the planner is free to
 * pick any subset, and a short opinion routinely draws a six operator plan that touches five
 * of the seventeen paths. Signing that plan used to produce no specimen at all, which is the
 * demo failing at the last step with every operator green.
 */
export function uncoveredPaths(ids: string[]): RenderPath[] {
  const covered = new Set<RenderPath>()
  for (const id of resolveDeps(ids)) {
    for (const path of getOperator(id).touches) covered.add(path)
  }
  return ALL_RENDER_PATHS.filter(path => !covered.has(path))
}

/**
 * Adds the fewest operators that cover whatever the planner's picks left unmeasured.
 *
 * Greedy set cover, largest contribution first, ties broken by id so the same opinion always
 * produces the same plan. Field operators sort last because they are the only ones that leave
 * the building: pulling one in for coverage would spend a scrape the planner deliberately
 * declined. Nothing else needs them, since every path a field operator touches is also touched
 * by a forensics, semantics or esoteric operator.
 */
export function coverageAdditions(pickedIds: string[]): { id: string; covers: RenderPath[] }[] {
  const outstanding = new Set(uncoveredPaths(pickedIds))
  if (!outstanding.size) return []

  const chosen = new Set(resolveDeps(pickedIds))
  const candidates = allOperators()
    .filter(op => !chosen.has(op.id))
    .sort((a, b) => {
      const wing = Number(a.wing === 'field') - Number(b.wing === 'field')
      return wing !== 0 ? wing : a.id.localeCompare(b.id)
    })

  const additions: { id: string; covers: RenderPath[] }[] = []
  while (outstanding.size) {
    let best: Operator | undefined
    let bestCovers: RenderPath[] = []
    for (const op of candidates) {
      if (chosen.has(op.id)) continue
      const covers = op.touches.filter(path => outstanding.has(path))
      if (covers.length > bestCovers.length) {
        best = op
        bestCovers = covers
      }
    }
    // Unreachable while the registration test holds, and a guard rather than an infinite
    // loop if a future operator library stops covering every path.
    if (!best) break
    for (const id of resolveDeps([best.id])) chosen.add(id)
    for (const path of bestCovers) outstanding.delete(path)
    additions.push({ id: best.id, covers: bestCovers })
  }
  return additions
}

function pulledBy(id: string, closure: Operator[], picked: Set<string>): string {
  const parents = closure.filter(op => op.needs.includes(id)).map(op => op.id).sort()
  for (const parent of parents) if (picked.has(parent)) return parent
  return parents.length ? parents[0] : 'another pick'
}

function assemble(
  opinion: string,
  batchId: string,
  answer: PlannerAnswer,
  rejectedFirst?: string,
): WorkOrder {
  const known = new Set(allOperators().map(op => op.id))
  const kept: Pick[] = []
  const dropped: string[] = []
  const seen = new Set<string>()

  for (const pick of answer.picks ?? []) {
    if (seen.has(pick.id)) continue
    seen.add(pick.id)
    if (!known.has(pick.id)) {
      dropped.push(pick.id)
      continue
    }
    kept.push(pick)
  }

  const pickedIds = new Set(kept.map(p => p.id))

  // Coverage is a hard constraint, not a preference. Without this a valid plan can run every
  // operator green and still strike no specimen, because the foundry refuses to default a
  // parameter nobody measured.
  const additions = coverageAdditions([...pickedIds])
  const withCoverage = new Set([...pickedIds, ...additions.map(a => a.id)])

  const closureIds = resolveDeps([...withCoverage])
  const closure = closureIds.map(getOperator)
  const rationales = new Map(kept.map(p => [p.id, p.rationale]))
  for (const add of additions) {
    rationales.set(
      add.id,
      `added so the specimen has a measurement for ${add.covers.join(', ')}, which nothing the planner picked measures`,
    )
  }
  for (const op of closure) {
    if (rationales.has(op.id)) continue
    rationales.set(op.id, `pulled in as a dependency of ${pulledBy(op.id, closure, withCoverage)}`)
  }

  const layers = safeLayers(closure)
  const notes = [answer.notes?.trim() || 'No planner notes returned.']
  if (additions.length) {
    notes.push(
      `Added ${additions.map(a => a.id).join(', ')} for render coverage: the picked operators left ${additions.flatMap(a => a.covers).length} of the ${ALL_RENDER_PATHS.length} specimen parameters unmeasured, and the foundry will not default one.`,
    )
  }
  for (const id of dropped) {
    notes.push(`Dropped "${id}": it is not in the operator library, so it cannot run.`)
  }
  if (rejectedFirst) {
    notes.push(`The first plan was rejected (${rejectedFirst}), so this is the corrected one.`)
  }

  return {
    batchId,
    opinion,
    operators: layers.flat().map(op => ({
      id: op.id,
      rationale: rationales.get(op.id) as string,
      enabled: true,
    })),
    ...estimates(layers),
    plannerNotes: notes.join(' '),
    createdAt: new Date().toISOString(),
  }
}

/**
 * Last resort. A model that cannot produce a runnable plan twice does not get to
 * end the shift, so the whole library runs in dependency order and the notes say
 * exactly that, because the human signing it deserves to know the line was not
 * composed for their text.
 */
function fullLibraryOrder(opinion: string, batchId: string, reason?: string): WorkOrder {
  const layers = safeLayers(allOperators())
  const notes = [
    'The planner could not return a runnable plan, so this shift falls back to the full library in',
    'dependency order. Every instrument runs, and nothing here was chosen for this particular text.',
  ].join(' ')

  return {
    batchId,
    opinion,
    operators: layers.flat().map(op => ({
      id: op.id,
      rationale: 'included by the full library fallback, not chosen for this text',
      enabled: true,
    })),
    ...estimates(layers),
    plannerNotes: reason ? `${notes} Last reason: ${reason}` : notes,
    createdAt: new Date().toISOString(),
  }
}

/**
 * One planner call, one retry carrying the rejection reason, then the full library.
 * A bad answer from the model costs a second call, never the run.
 */
export async function composePlan(opinion: string, batchId: string): Promise<WorkOrder> {
  const system = buildSystemPrompt(allOperators())
  let rejection: string | undefined

  for (let attempt = 0; attempt < 2; attempt++) {
    let answer: PlannerAnswer
    try {
      answer = await chatJson<PlannerAnswer>({
        system,
        user: buildUserPrompt(opinion, rejection),
        schema: PICK_SCHEMA,
      })
    } catch (err) {
      rejection = `the planner call failed with "${message(err)}"`
      continue
    }

    let order: WorkOrder
    try {
      order = assemble(opinion, batchId, answer, attempt > 0 ? rejection : undefined)
    } catch (err) {
      // A shape the schema should have prevented, or an operator declaring a need
      // that is not registered. Either way it is a rejected plan, not a dead run.
      rejection = `the answer could not be assembled into a work order: "${message(err)}"`
      continue
    }

    const check = validateWorkOrder(order)
    if (check.ok) return order
    rejection = check.reason
  }

  return fullLibraryOrder(opinion, batchId, rejection)
}
