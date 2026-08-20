import type { Database as Db } from 'better-sqlite3'
import { openDb } from '@/lib/db'

/**
 * One SQLite connection for the gate: the two plan routes and the gate page all
 * read and write the same batch. The path matches `lib/demo/state.ts` so the whole
 * app points at one file.
 *
 * The handle hangs off globalThis because Next reloads route modules in development,
 * and a plain module variable would leak a connection on every reload.
 */
export function gateDbPath(): string {
  return process.env.DOXA_DB_PATH ?? 'data/doxa.db'
}

const handle = globalThis as unknown as { doxaGateDb?: Db }

export function gateDb(): Db {
  if (!handle.doxaGateDb) handle.doxaGateDb = openDb(gateDbPath())
  return handle.doxaGateDb
}
