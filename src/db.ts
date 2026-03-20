import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'

const DB_PATH = process.env.DB_PATH || path.join(os.homedir(), '.chef-api', 'chef.db')

// Ensure directory exists
import fs from 'fs'
const dbDir = path.dirname(DB_PATH)
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true })
}

export const db: Database.Database = new Database(DB_PATH)

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// Migrations
db.exec(`
  CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    ttl INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS job_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    target TEXT,
    command TEXT,
    status TEXT NOT NULL,
    output TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)

export interface CacheRow {
  key: string
  value: string
  ttl: number
  created_at: number
}

export interface Todo {
  id: number
  title: string
  description: string | null
  completed: number
  created_at: string
  updated_at: string
}

export interface JobHistory {
  id: number
  type: string
  target: string | null
  command: string | null
  status: string
  output: string | null
  created_at: string
}
