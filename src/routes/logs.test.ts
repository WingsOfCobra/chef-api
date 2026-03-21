import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FastifyInstance } from 'fastify'
import { buildApp, authHeaders } from '../test/helpers'
import { db } from '../db'
import logsRoutes from './logs'

// Mock child_process for tailSource
vi.mock('child_process', () => ({
  execSync: vi.fn(() => 'log line 1\nlog line 2\n'),
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => true),
      mkdirSync: actual.mkdirSync,
      readFileSync: actual.readFileSync,
    },
    existsSync: vi.fn(() => true),
  }
})

describe('logs routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    db.prepare('DELETE FROM log_index').run()
    db.prepare('DELETE FROM log_sources').run()
    app = await buildApp({ routes: [{ plugin: logsRoutes, prefix: '/logs' }] })
  })

  afterEach(async () => {
    await app.close()
  })

  describe('GET /logs/files', () => {
    it('requires auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/logs/files' })
      expect(res.statusCode).toBe(401)
    })

    it('returns log sources', async () => {
      db.prepare(
        'INSERT INTO log_sources (name, type, path) VALUES (?, ?, ?)'
      ).run('syslog', 'file', '/var/log/syslog')

      const res = await app.inject({
        method: 'GET',
        url: '/logs/files',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveLength(1)
      expect(body[0].name).toBe('syslog')
    })
  })

  describe('GET /logs/tail/:source', () => {
    it('tails a source', async () => {
      db.prepare(
        'INSERT INTO log_sources (name, type, path) VALUES (?, ?, ?)'
      ).run('test', 'file', '/var/log/test.log')

      const res = await app.inject({
        method: 'GET',
        url: '/logs/tail/test',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.source).toBe('test')
      expect(body.lines).toBeInstanceOf(Array)
    })
  })

  describe('GET /logs/search', () => {
    it('requires q parameter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/logs/search',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error).toContain('Missing')
    })

    it('searches indexed logs', async () => {
      db.prepare(
        'INSERT INTO log_index (source, line, timestamp) VALUES (?, ?, ?)'
      ).run('test', 'ERROR: something broke', '2026-03-21T01:00:00Z')

      const res = await app.inject({
        method: 'GET',
        url: '/logs/search?q=ERROR',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.query).toBe('ERROR')
      expect(body.results).toHaveLength(1)
    })
  })

  describe('GET /logs/stats', () => {
    it('returns index statistics', async () => {
      db.prepare(
        'INSERT INTO log_index (source, line, timestamp) VALUES (?, ?, ?)'
      ).run('src', 'line', '2026-03-21T01:00:00Z')

      const res = await app.inject({
        method: 'GET',
        url: '/logs/stats',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toHaveLength(1)
    })
  })
})
