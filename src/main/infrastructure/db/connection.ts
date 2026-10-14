import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

export interface OpenedDatabase {
  db: Db
  sqlite: Database.Database
  databasePath: string
  backupsPath: string
}

const MAX_SNAPSHOTS = 10

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/** Takes a consistent snapshot with SQLite's online backup API and prunes old ones. */
export async function snapshotDatabase(sqlite: Database.Database, backupsPath: string, label: string): Promise<string> {
  fs.mkdirSync(backupsPath, { recursive: true })
  const target = path.join(backupsPath, `app-${timestamp()}-${label}.db`)
  await sqlite.backup(target)
  const automatic = fs
    .readdirSync(backupsPath)
    .filter((f) => f.startsWith('app-') && f.endsWith('-auto.db'))
    .sort()
  for (const old of automatic.slice(0, Math.max(0, automatic.length - MAX_SNAPSHOTS))) {
    fs.rmSync(path.join(backupsPath, old), { force: true })
  }
  return target
}

/**
 * Opens (or creates) the application database and applies forward-only migrations.
 * An existing database is snapshotted first, so a failed migration can never be the only copy
 * (spec DATA-03, DATA-04). Migrations run inside a transaction by Drizzle's migrator.
 */
export async function openDatabase(dataDir: string, migrationsFolder: string): Promise<OpenedDatabase> {
  fs.mkdirSync(dataDir, { recursive: true })
  const databasePath = path.join(dataDir, 'app.db')
  const backupsPath = path.join(dataDir, 'backups')
  const existed = fs.existsSync(databasePath)

  const sqlite = new Database(databasePath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')

  if (existed) await snapshotDatabase(sqlite, backupsPath, 'auto')

  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder })
  return { db, sqlite, databasePath, backupsPath }
}
