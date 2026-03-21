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

  CREATE TABLE IF NOT EXISTS cron_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    schedule TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('ssh', 'http')),
    config TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    preset TEXT,
    last_run_at TEXT,
    last_run_status TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS cron_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    exit_code INTEGER,
    stdout TEXT,
    stderr TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_cron_history_job_id ON cron_history(job_id);
  CREATE INDEX IF NOT EXISTS idx_cron_history_created_at ON cron_history(created_at);

  CREATE TABLE IF NOT EXISTS hook_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    source TEXT,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_hook_events_type ON hook_events(event_type);
  CREATE INDEX IF NOT EXISTS idx_hook_events_created_at ON hook_events(created_at);

  CREATE TABLE IF NOT EXISTS log_sources (
    name TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('file', 'journald', 'docker')),
    path TEXT,
    last_indexed_at TEXT,
    last_offset INTEGER DEFAULT 0
  );
`)

// FTS5 virtual table — must be created separately (not inside transaction)
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS log_index USING fts5(
    source,
    line,
    timestamp,
    tokenize='porter unicode61'
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

export interface CronJob {
  id: number
  name: string
  schedule: string
  type: 'ssh' | 'http'
  config: string
  enabled: number
  preset: string | null
  last_run_at: string | null
  last_run_status: string | null
  created_at: string
  updated_at: string
}

export interface CronHistory {
  id: number
  job_id: number
  status: string
  exit_code: number | null
  stdout: string | null
  stderr: string | null
  duration_ms: number | null
  created_at: string
}

export interface HookEvent {
  id: number
  event_type: string
  source: string | null
  payload: string
  created_at: string
}

export interface LogSource {
  name: string
  type: 'file' | 'journald' | 'docker'
  path: string | null
  last_indexed_at: string | null
  last_offset: number
}

export interface LogSearchResult {
  source: string
  line: string
  timestamp: string
  rank: number
}
