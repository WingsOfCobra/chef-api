import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FastifyInstance } from 'fastify'
import { buildApp, authHeaders } from '../test/helpers'
import emailRoutes from './email'

// Mock imapflow
vi.mock('imapflow', () => ({
  ImapFlow: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
    search: vi.fn().mockResolvedValue([]),
    fetch: vi.fn().mockReturnValue({ [Symbol.asyncIterator]: () => ({ next: () => ({ done: true }) }) }),
  })),
}))

describe('email routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = await buildApp({ routes: [{ plugin: emailRoutes, prefix: '/email' }] })
  })

  afterEach(async () => {
    await app.close()
  })

  describe('GET /email/unread', () => {
    it('requires auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/email/unread' })
      expect(res.statusCode).toBe(401)
    })

    it('returns 503 when IMAP is not configured', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/email/unread',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(503)
      expect(res.json().error).toContain('not configured')
    })
  })

  describe('GET /email/search', () => {
    it('requires auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/email/search' })
      expect(res.statusCode).toBe(401)
    })

    it('returns 503 when IMAP is not configured', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/email/search?from=test',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(503)
    })
  })

  describe('GET /email/thread/:uid', () => {
    it('requires auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/email/thread/1' })
      expect(res.statusCode).toBe(401)
    })

    it('returns 503 when IMAP is not configured', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/email/thread/123',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(503)
    })
  })
})
