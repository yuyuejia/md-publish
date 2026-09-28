import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'

export type Db = Database.Database

interface Migration {
  version: number
  up: (db: Db) => void
}

const migrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '',
          dir TEXT NOT NULL DEFAULT '',
          mtime INTEGER NOT NULL DEFAULT 0,
          size INTEGER NOT NULL DEFAULT 0,
          tags TEXT NOT NULL DEFAULT '[]',
          summary TEXT,
          cover TEXT
        );

        CREATE TABLE IF NOT EXISTS publish_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          doc_id TEXT NOT NULL,
          platform TEXT NOT NULL,
          status TEXT NOT NULL,
          post_id TEXT,
          post_url TEXT,
          draft_only INTEGER NOT NULL DEFAULT 1,
          error TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_records_doc ON publish_records(doc_id);

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `)
    }
  }
]

let db: Db | null = null

export function initDb(): Db {
  if (db) return db
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'data.db')
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

export function getDb(): Db {
  if (!db) throw new Error('Database not initialized. Call initDb() first.')
  return db
}

function runMigrations(instance: Db): void {
  const current = instance.pragma('user_version', { simple: true }) as number
  for (const migration of migrations) {
    if (migration.version > current) {
      const tx = instance.transaction(() => {
        migration.up(instance)
        instance.pragma(`user_version = ${migration.version}`)
      })
      tx()
    }
  }
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, value)
}
