import { randomUUID } from 'node:crypto'
import '@/lib/operators'
import { insertBatch, insertWorkOrder } from '@/lib/db'
import { composePlan } from '@/lib/planner/plan'
import { gateDb } from './db'

/**
 * Intake. The one place an opinion is cleaned, measured and refused.
 *
 * Cleaning happens before the planner reads the text and before the row is written,
 * so the opinion the planner reasoned about, the opinion on the certificate and the
 * opinion in the database are the same string. A copy pasted out of a document
 * arrives full of smart quotes and line breaks, and two people typing the same take
 * should not get two different batches because one of them used Word.
 */

const MIN_WORDS = 3
const MAX_CHARS = 500

const SMART = new Map<string, string>([
  ['‘', "'"], ['’', "'"], ['‚', "'"], ['‛', "'"], ['′', "'"],
  ['“', '"'], ['”', '"'], ['„', '"'], ['‟', '"'], ['″', '"'],
])

function normalise(raw: string): string {
  const straightened = raw.replace(/[‘’‚‛′“”„‟″]/g, c =>
    SMART.get(c) as string,
  )
  // Zero width characters survive a copy and paste and would count toward the length.
  return straightened.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim()
}

function wordCount(text: string): number {
  return text.split(' ').filter(Boolean).length
}

/** Sortable by time, short enough to read out loud, unique enough for a shift. */
function newBatchId(): string {
  const stamp = Date.now().toString(36).toUpperCase()
  const salt = randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase()
  return `B-${stamp}-${salt}`
}

function bad(error: string, status = 400): Response {
  return Response.json({ error }, { status })
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return bad('The request body is not JSON. Send {"opinion": "..."}.')
  }

  const raw = (body as { opinion?: unknown } | null)?.opinion
  if (typeof raw !== 'string') {
    return bad('Send a JSON body with an "opinion" string in it.')
  }

  const opinion = normalise(raw)
  const words = wordCount(opinion)
  if (words < MIN_WORDS) {
    return bad(`An opinion needs at least ${MIN_WORDS} words to assay. This one has ${words}.`)
  }
  if (opinion.length > MAX_CHARS) {
    return bad(
      `An opinion has to fit in ${MAX_CHARS} characters. This one is ${opinion.length}, so cut ${opinion.length - MAX_CHARS}.`,
    )
  }

  const batchId = newBatchId()
  const order = await composePlan(opinion, batchId)

  // Both rows land before the order is handed back, so a refresh of the gate screen
  // reads the same plan the caller was given rather than composing a second one.
  const db = gateDb()
  insertBatch(db, { id: batchId, opinion, createdAt: order.createdAt })
  insertWorkOrder(db, order)

  return Response.json(order)
}
