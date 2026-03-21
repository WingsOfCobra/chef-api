import { execSync } from 'child_process'
import fs from 'fs'
import { db, LogSource, LogSearchResult } from '../db'
import { config, LogSourceConfig } from '../config'
import * as docker from './docker.service'

export function initLogSources(): void {
  const stmt = db.prepare(
    `INSERT INTO log_sources (name, type, path)
     VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET type = excluded.type, path = excluded.path`
  )

  for (const source of config.logSources) {
    stmt.run(source.name, source.type, source.path)
  }
}

export function listLogSources(): LogSource[] {
  return db.prepare('SELECT * FROM log_sources ORDER BY name').all() as LogSource[]
}

export function tailSource(sourceName: string, lines?: number): string[] {
  const rawCount = lines ?? config.logTailDefaultLines
  const lineCount = Math.max(1, Math.min(10000, Math.floor(rawCount) || 100))
  const source = db.prepare('SELECT * FROM log_sources WHERE name = ?').get(sourceName) as LogSource | undefined

  if (!source) {
    throw new Error(`Unknown log source: ${sourceName}`)
  }

  try {
    if (source.type === 'file') {
      if (!source.path || !fs.existsSync(source.path)) {
        return [`Log file not found: ${source.path}`]
      }
      const output = execSync(`tail -n ${lineCount} ${JSON.stringify(source.path)}`, {
        encoding: 'utf-8',
        timeout: 10000,
      })
      return output.trim().split('\n').filter(Boolean)
    }

    if (source.type === 'journald') {
      const unit = source.path ?? sourceName
      const output = execSync(
        `journalctl -u ${JSON.stringify(unit)} -n ${lineCount} --no-pager -o short-iso 2>/dev/null || echo "journalctl not available"`,
        { encoding: 'utf-8', timeout: 10000 },
      )
      return output.trim().split('\n').filter(Boolean)
    }

    if (source.type === 'docker') {
      // source.path is the container ID/name
      // Use sync approach for simplicity — shell out to docker logs
      const containerId = source.path ?? sourceName
      const output = execSync(
        `docker logs --tail ${lineCount} ${JSON.stringify(containerId)} 2>&1`,
        { encoding: 'utf-8', timeout: 10000 },
      )
      return output.trim().split('\n').filter(Boolean)
    }

    return []
  } catch (err: any) {
    return [`Error reading ${source.type} source "${sourceName}": ${err.message}`]
  }
}

export function searchLogs(
  query: string,
  opts: { source?: string; limit?: number; offset?: number } = {},
): LogSearchResult[] {
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0

  if (opts.source) {
    return db.prepare(
      `SELECT source, line, timestamp, rank
       FROM log_index
       WHERE log_index MATCH ? AND source = ?
       ORDER BY rank
       LIMIT ? OFFSET ?`
    ).all(query, opts.source, limit, offset) as LogSearchResult[]
  }

  return db.prepare(
    `SELECT source, line, timestamp, rank
     FROM log_index
     WHERE log_index MATCH ?
     ORDER BY rank
     LIMIT ? OFFSET ?`
  ).all(query, limit, offset) as LogSearchResult[]
}

export function indexSource(sourceName: string): number {
  const source = db.prepare('SELECT * FROM log_sources WHERE name = ?').get(sourceName) as LogSource | undefined
  if (!source) return 0

  const lines = tailSource(sourceName, 1000)
  if (lines.length === 0) return 0

  const timestamp = new Date().toISOString()
  const insert = db.prepare(
    'INSERT INTO log_index (source, line, timestamp) VALUES (?, ?, ?)'
  )

  const insertMany = db.transaction((logLines: string[]) => {
    let count = 0
    for (const line of logLines) {
      if (line.trim()) {
        insert.run(sourceName, line, timestamp)
        count++
      }
    }
    return count
  })

  const count = insertMany(lines)

  db.prepare(
    "UPDATE log_sources SET last_indexed_at = datetime('now'), last_offset = last_offset + ? WHERE name = ?"
  ).run(count, sourceName)

  return count
}

export function runIndexCycle(): void {
  const sources = listLogSources()
  for (const source of sources) {
    try {
      indexSource(source.name)
    } catch (err: any) {
      console.error(`Failed to index log source "${source.name}":`, err.message)
    }
  }
}

export function getIndexStats(): { source: string; indexed_lines: number }[] {
  return db.prepare(
    `SELECT source, COUNT(*) as indexed_lines FROM log_index GROUP BY source`
  ).all() as { source: string; indexed_lines: number }[]
}
