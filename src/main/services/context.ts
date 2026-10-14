import type Database from 'better-sqlite3'
import type { Db } from '../infrastructure/db/connection'

/**
 * Everything a service needs from the outside world. Services never import Electron, so they
 * can run under plain Node in tests with a temporary directory and a fake `trash`.
 */
export interface AppContext {
  db: Db
  sqlite: Database.Database
  userDataPath: string
  defaultWorkspacePath: string
  /** Sends a file or folder to the Recycle Bin. */
  trash(absolutePath: string): Promise<void>
  now(): number
}
