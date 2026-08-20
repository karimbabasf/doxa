import Database from 'better-sqlite3'
import type { Database as Db } from 'better-sqlite3'
import type { OperatorResult, RenderParams, WorkOrder } from './types'

export type Batch = {
  id: string
  opinion: string
  createdAt: string
  embedding?: number[]
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  opinion TEXT NOT NULL,
  created_at TEXT NOT NULL,
  embedding TEXT,
  verdict TEXT
);
CREATE TABLE IF NOT EXISTS work_orders (
  batch_id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  signed_at TEXT
);
CREATE TABLE IF NOT EXISTS results (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS specimens (
  batch_id TEXT PRIMARY KEY,
  params TEXT NOT NULL,
  attribution TEXT NOT NULL,
  png BLOB
);
CREATE INDEX IF NOT EXISTS results_by_batch ON results (batch_id, seq);
`

export function openDb(path: string): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA)
  return db
}

export function insertBatch(db: Db, b: Batch): void {
  db.prepare('INSERT INTO batches (id, opinion, created_at, embedding) VALUES (?, ?, ?, ?)').run(
    b.id,
    b.opinion,
    b.createdAt,
    b.embedding ? JSON.stringify(b.embedding) : null,
  )
}

export function getBatch(db: Db, id: string): Batch | undefined {
  const row = db
    .prepare('SELECT id, opinion, created_at, embedding FROM batches WHERE id = ?')
    .get(id) as { id: string; opinion: string; created_at: string; embedding: string | null } | undefined
  if (!row) return undefined
  return {
    id: row.id,
    opinion: row.opinion,
    createdAt: row.created_at,
    embedding: row.embedding ? (JSON.parse(row.embedding) as number[]) : undefined,
  }
}

/**
 * The one seam left open for the similarity graph. EMBED runs as an operator, so
 * its vector only exists after the run; this lets the run attach it without a migration.
 */
export function setBatchEmbedding(db: Db, id: string, embedding: number[]): void {
  db.prepare('UPDATE batches SET embedding = ? WHERE id = ?').run(JSON.stringify(embedding), id)
}

export function setBatchVerdict(db: Db, id: string, verdict: string): void {
  db.prepare('UPDATE batches SET verdict = ? WHERE id = ?').run(verdict, id)
}

export function insertResult(db: Db, batchId: string, r: OperatorResult): void {
  db.prepare('INSERT INTO results (batch_id, operator_id, json) VALUES (?, ?, ?)').run(
    batchId,
    r.id,
    JSON.stringify(r),
  )
}

export function getResults(db: Db, batchId: string): OperatorResult[] {
  const rows = db
    .prepare('SELECT json FROM results WHERE batch_id = ? ORDER BY seq')
    .all(batchId) as { json: string }[]
  return rows.map((r) => JSON.parse(r.json) as OperatorResult)
}

export function insertWorkOrder(db: Db, order: WorkOrder): void {
  db.prepare('INSERT OR REPLACE INTO work_orders (batch_id, json, signed_at) VALUES (?, ?, NULL)').run(
    order.batchId,
    JSON.stringify(order),
  )
}

export function signWorkOrder(db: Db, batchId: string, order: WorkOrder, signedAt: string): void {
  db.prepare('UPDATE work_orders SET json = ?, signed_at = ? WHERE batch_id = ?').run(
    JSON.stringify(order),
    signedAt,
    batchId,
  )
}

export function getWorkOrder(
  db: Db,
  batchId: string,
): { order: WorkOrder; signedAt: string | null } | undefined {
  const row = db
    .prepare('SELECT json, signed_at FROM work_orders WHERE batch_id = ?')
    .get(batchId) as { json: string; signed_at: string | null } | undefined
  if (!row) return undefined
  return { order: JSON.parse(row.json) as WorkOrder, signedAt: row.signed_at }
}

export function insertSpecimen(
  db: Db,
  batchId: string,
  params: RenderParams,
  attribution: unknown,
  png?: Buffer,
): void {
  db.prepare(
    'INSERT OR REPLACE INTO specimens (batch_id, params, attribution, png) VALUES (?, ?, ?, ?)',
  ).run(batchId, JSON.stringify(params), JSON.stringify(attribution), png ?? null)
}
