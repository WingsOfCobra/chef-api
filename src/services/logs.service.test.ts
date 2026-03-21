import { vi, describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db'
import * as logsService from './logs.service'

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn((cmd: string) => {
    if (cmd.includes('docker logs')) return 'container log line 1\ncontainer log line 2\n'
    if (cmd.includes('journalctl')) return '2026-03-21T01:00:00+0000 unit[1]: started\n'
    if (cmd.includes('tail')) return 'line1\nline2\nline3\n'
    return ''
  }),
}))

// Mock fs
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn((path: string) => path === '/var/log/test.log'),
      mkdirSync: actual.mkdirSync,
      readFileSync: actual.readFileSync,
    },
    existsSync: vi.fn((path: string) => path === '/var/log/test.log'),
  }
})

describe('logs.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.prepare('DELETE FROM log_index').run()
    db.prepare('DELETE FROM log_sources').run()
  })

  describe('initLogSources / listLogSources', () => {
    it('initializes sources from config', () => {
      // Manually insert a source since config.logSources is empty in tests
      db.prepare(
        'INSERT INTO log_sources (name, type, path) VALUES (?, ?, ?)'
      ).run('test-log', 'file', '/var/log/test.log')

      const sources = logsService.listLogSources()
      expect(sources).toHaveLength(1)
      expect(sources[0].name).toBe('test-log')
      expect(sources[0].type).toBe('file')
    })
  })

  describe('tailSource', () => {
    it('tails a file source', () => {
      db.prepare(
        'INSERT INTO log_sources (name, type, path) VALUES (?, ?, ?)'
      ).run('test-file', 'file', '/var/log/test.log')

      const lines = logsService.tailSource('test-file', 10)
      expect(lines).toEqual(['line1', 'line2', 'line3'])
    })

    it('tails a journald source', () => {
      db.prepare(
        'INSERT INTO log_sources (name, type, path) VALUES (?, ?, ?)'
      ).run('test-journal', 'journald', 'docker.service')

      const lines = logsService.tailSource('test-journal', 10)
      expect(lines.length).toBeGreaterThan(0)
    })

    it('tails a docker source', () => {
      db.prepare(
        'INSERT INTO log_sources (name, type, path) VALUES (?, ?, ?)'
      ).run('test-docker', 'docker', 'my-container')

      const lines = logsService.tailSource('test-docker', 10)
      expect(lines).toEqual(['container log line 1', 'container log line 2'])
    })

    it('throws for unknown source', () => {
      expect(() => logsService.tailSource('nonexistent')).toThrow('Unknown log source')
    })
  })

  describe('FTS5 search', () => {
    it('indexes and searches log lines', () => {
      db.prepare(
        'INSERT INTO log_sources (name, type, path) VALUES (?, ?, ?)'
      ).run('test-search', 'file', '/var/log/test.log')

      // Directly insert into FTS5
      db.prepare(
        'INSERT INTO log_index (source, line, timestamp) VALUES (?, ?, ?)'
      ).run('test-search', 'ERROR: connection timeout on server-1', '2026-03-21T01:00:00Z')
      db.prepare(
        'INSERT INTO log_index (source, line, timestamp) VALUES (?, ?, ?)'
      ).run('test-search', 'INFO: request processed successfully', '2026-03-21T01:01:00Z')
      db.prepare(
        'INSERT INTO log_index (source, line, timestamp) VALUES (?, ?, ?)'
      ).run('other-source', 'ERROR: disk full', '2026-03-21T01:02:00Z')

      const results = logsService.searchLogs('ERROR')
      expect(results).toHaveLength(2)

      const filtered = logsService.searchLogs('ERROR', { source: 'test-search' })
      expect(filtered).toHaveLength(1)
      expect(filtered[0].line).toContain('connection timeout')
    })

    it('returns empty for no matches', () => {
      const results = logsService.searchLogs('"nonexistentterm"')
      expect(results).toEqual([])
    })

    it('respects limit and offset', () => {
      for (let i = 0; i < 5; i++) {
        db.prepare(
          'INSERT INTO log_index (source, line, timestamp) VALUES (?, ?, ?)'
        ).run('src', `error log ${i}`, '2026-03-21T01:00:00Z')
      }

      const results = logsService.searchLogs('error', { limit: 2, offset: 0 })
      expect(results).toHaveLength(2)
    })
  })

  describe('indexSource', () => {
    it('indexes lines from a source', () => {
      db.prepare(
        'INSERT INTO log_sources (name, type, path) VALUES (?, ?, ?)'
      ).run('idx-test', 'file', '/var/log/test.log')

      const count = logsService.indexSource('idx-test')
      expect(count).toBe(3) // line1, line2, line3

      const source = db.prepare('SELECT * FROM log_sources WHERE name = ?').get('idx-test') as any
      expect(source.last_indexed_at).not.toBeNull()
      expect(source.last_offset).toBe(3)
    })

    it('returns 0 for unknown source', () => {
      expect(logsService.indexSource('nonexistent')).toBe(0)
    })
  })

  describe('getIndexStats', () => {
    it('returns per-source stats', () => {
      db.prepare(
        'INSERT INTO log_index (source, line, timestamp) VALUES (?, ?, ?)'
      ).run('src-a', 'line1', '2026-03-21T01:00:00Z')
      db.prepare(
        'INSERT INTO log_index (source, line, timestamp) VALUES (?, ?, ?)'
      ).run('src-a', 'line2', '2026-03-21T01:00:00Z')
      db.prepare(
        'INSERT INTO log_index (source, line, timestamp) VALUES (?, ?, ?)'
      ).run('src-b', 'line1', '2026-03-21T01:00:00Z')

      const stats = logsService.getIndexStats()
      expect(stats).toHaveLength(2)
      expect(stats.find((s) => s.source === 'src-a')?.indexed_lines).toBe(2)
      expect(stats.find((s) => s.source === 'src-b')?.indexed_lines).toBe(1)
    })
  })
})
