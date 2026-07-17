import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

export const SHORT_SHARE_CODE_PATTERN = /^[A-Za-z0-9_-]{16}$/u

const DATABASE_FILENAME = 'transferhero-share-links.sqlite'
const MAX_DATABASE_BYTES = 128 * 1024 * 1024
const MAX_CREATE_ATTEMPTS = 8
const INSERT_HEADROOM_PAGES = 16

let database: Database.Database | null | undefined

function configuredDatabasePath(): string | null {
  const explicitPath = process.env.SHARE_LINK_DB_PATH?.trim()
  if (explicitPath) {
    const unsafeProductionMemory = process.env.NODE_ENV === 'production'
      && explicitPath === ':memory:'
      && process.env.LOCAL_SHARE_SMOKE !== 'true'
    if (unsafeProductionMemory) {
      throw new Error('SHARE_LINK_DB_PATH=:memory: is not durable in production')
    }
    if (process.env.NODE_ENV === 'production' && explicitPath !== ':memory:' && !path.isAbsolute(explicitPath)) {
      throw new Error('SHARE_LINK_DB_PATH must be absolute in production')
    }
    return explicitPath
  }

  const volumeMount = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim()
  if (volumeMount) return path.join(volumeMount, DATABASE_FILENAME)

  // Local development still gets realistic short links without writing files.
  return process.env.NODE_ENV === 'production' ? null : ':memory:'
}

function getDatabase(): Database.Database | null {
  if (database !== undefined) return database

  const databasePath = configuredDatabasePath()
  if (!databasePath) {
    database = null
    return database
  }

  if (databasePath !== ':memory:') {
    mkdirSync(path.dirname(databasePath), { recursive: true })
  }

  const opened = new Database(databasePath)
  opened.pragma('journal_mode = WAL')
  opened.pragma('synchronous = FULL')
  opened.pragma('busy_timeout = 5000')
  opened.pragma('wal_autocheckpoint = 1000')
  opened.exec(`
    CREATE TABLE IF NOT EXISTS share_links (
      code TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    ) WITHOUT ROWID
  `)
  const pageSize = opened.pragma('page_size', { simple: true }) as number
  const maximumPages = Math.max(1, Math.floor(MAX_DATABASE_BYTES / pageSize))
  opened.pragma(`max_page_count = ${maximumPages}`)
  database = opened
  return database
}

/** Stores an existing signed trip token and returns an unguessable short code. */
export function storeShareToken(token: string): string | null {
  const store = getDatabase()
  if (!store) return null

  const pageCount = store.pragma('page_count', { simple: true }) as number
  const maximumPageCount = store.pragma('max_page_count', { simple: true }) as number
  if (pageCount + INSERT_HEADROOM_PAGES >= maximumPageCount) return null

  const insert = store.prepare(`
    INSERT OR IGNORE INTO share_links (code, token, created_at_ms)
    VALUES (?, ?, ?)
  `)
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
    const code = randomBytes(12).toString('base64url')
    const result = insert.run(code, token, Date.now())
    if (result.changes === 1) return code
  }

  throw new Error('Unable to allocate a unique short share code')
}

/** Returns the signed token behind a short code, or null when it does not exist. */
export function findStoredShareToken(code: string): string | null {
  if (!SHORT_SHARE_CODE_PATTERN.test(code)) return null
  const store = getDatabase()
  if (!store) throw new Error('Short share storage is not configured')

  const row = store
    .prepare('SELECT token FROM share_links WHERE code = ?')
    .get(code) as { token?: unknown } | undefined
  return typeof row?.token === 'string' ? row.token : null
}

/** Closes the singleton so tests can verify persistence across a reopen. */
export function closeShareLinkStoreForTests(): void {
  database?.close()
  database = undefined
}
