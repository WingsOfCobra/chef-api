import crypto from 'crypto'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FastifyInstance } from 'fastify'
import { buildApp, authHeaders } from '../test/helpers'
import { db } from '../db'
import hooksRoutes from './hooks'

// Mock axios
vi.mock('axios', () => ({
  default: { post: vi.fn().mockResolvedValue({ status: 200 }) },
}))

describe('hooks routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    db.prepare('DELETE FROM hook_events').run()
    app = await buildApp({ routes: [{ plugin: hooksRoutes, prefix: '/hooks' }] })
  })

  afterEach(async () => {
    await app.close()
  })

  describe('POST /hooks/agent-event', () => {
    it('returns 503 when webhook secret is not configured', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hooks/agent-event',
        payload: {
          eventType: 'agent.completed',
          source: 'test-agent',
          payload: { result: 'ok' },
        },
      })

      // WEBHOOK_SECRET is empty in test setup → 503
      expect(res.statusCode).toBe(503)
      expect(res.json().error).toContain('not configured')
    })

    it('does not require API key auth (uses webhook secret instead)', async () => {
      // No API key headers — should get 503 (not 401) because webhook secret is checked first
      const res = await app.inject({
        method: 'POST',
        url: '/hooks/agent-event',
        payload: { eventType: 'test', payload: {} },
      })

      expect(res.statusCode).toBe(503)
    })
  })

  describe('GET /hooks/events', () => {
    it('requires auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/hooks/events' })
      expect(res.statusCode).toBe(401)
    })

    it('returns paginated events', async () => {
      // Insert events directly into DB (agent-event endpoint requires webhook secret)
      for (let i = 0; i < 3; i++) {
        db.prepare(
          "INSERT INTO hook_events (event_type, source, payload) VALUES (?, ?, ?)"
        ).run('test', `src-${i}`, JSON.stringify({ i }))
      }

      const res = await app.inject({
        method: 'GET',
        url: '/hooks/events?limit=2&page=1',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.events).toHaveLength(2)
      expect(body.total).toBe(3)
    })

    it('filters by eventType', async () => {
      db.prepare(
        "INSERT INTO hook_events (event_type, payload) VALUES (?, ?)"
      ).run('type-a', '{}')
      db.prepare(
        "INSERT INTO hook_events (event_type, payload) VALUES (?, ?)"
      ).run('type-b', '{}')

      const res = await app.inject({
        method: 'GET',
        url: '/hooks/events?eventType=type-a',
        headers: authHeaders(),
      })

      expect(res.json().total).toBe(1)
      expect(res.json().events[0].event_type).toBe('type-a')
    })
  })

  describe('POST /hooks/notify', () => {
    it('requires auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hooks/notify',
        payload: { channel: 'telegram', message: 'test' },
      })
      expect(res.statusCode).toBe(401)
    })

    it('rejects invalid channel', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hooks/notify',
        headers: authHeaders(),
        payload: { channel: 'sms', message: 'test' },
      })
      // Zod validation failure
      expect(res.statusCode).toBe(500)
    })
  })
})
