import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FastifyInstance } from 'fastify'
import { buildApp, authHeaders } from '../test/helpers'
import secretsRoutes from './secrets'

vi.mock('../services/secrets.service', () => ({
  isConfigured: vi.fn().mockReturnValue(false),
  listSecrets: vi.fn().mockReturnValue([]),
  getSecret: vi.fn().mockReturnValue('secret-value'),
  injectSecrets: vi.fn().mockReturnValue({}),
}))

import * as secretsService from '../services/secrets.service'

describe('secrets routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp({ routes: [{ plugin: secretsRoutes, prefix: '/secrets' }] })
  })

  afterEach(async () => {
    await app.close()
  })

  describe('GET /secrets', () => {
    it('requires auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/secrets' })
      expect(res.statusCode).toBe(401)
    })

    it('returns 503 when BW_SESSION not configured', async () => {
      vi.mocked(secretsService.isConfigured).mockReturnValue(false)

      const res = await app.inject({
        method: 'GET',
        url: '/secrets',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(503)
      expect(res.json().error).toContain('not configured')
    })

    it('returns list of secret names only', async () => {
      vi.mocked(secretsService.isConfigured).mockReturnValue(true)
      vi.mocked(secretsService.listSecrets).mockReturnValue([
        { id: 'abc-123', name: 'my-api-key' },
        { id: 'def-456', name: 'db-password' },
      ])

      const res = await app.inject({
        method: 'GET',
        url: '/secrets',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveLength(2)
      expect(body[0]).toEqual({ id: 'abc-123', name: 'my-api-key' })
      expect(body[1]).toEqual({ id: 'def-456', name: 'db-password' })
      // Ensure no value fields are present
      for (const item of body) {
        expect(item).not.toHaveProperty('password')
        expect(item).not.toHaveProperty('value')
        expect(item).not.toHaveProperty('notes')
      }
    })
  })

  describe('GET /secrets/:name', () => {
    it('requires auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/secrets/my-secret' })
      expect(res.statusCode).toBe(401)
    })

    it('returns 503 when not configured', async () => {
      vi.mocked(secretsService.isConfigured).mockReturnValue(false)

      const res = await app.inject({
        method: 'GET',
        url: '/secrets/my-secret',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(503)
    })

    it('returns secret value', async () => {
      vi.mocked(secretsService.isConfigured).mockReturnValue(true)
      vi.mocked(secretsService.getSecret).mockReturnValue('super-secret-value')

      const res = await app.inject({
        method: 'GET',
        url: '/secrets/my-secret',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.name).toBe('my-secret')
      expect(body.value).toBe('super-secret-value')
    })

    it('returns 404 when secret not found', async () => {
      vi.mocked(secretsService.isConfigured).mockReturnValue(true)
      vi.mocked(secretsService.getSecret).mockImplementation(() => {
        throw new Error("Secret 'missing-secret' not found")
      })

      const res = await app.inject({
        method: 'GET',
        url: '/secrets/missing-secret',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(404)
      expect(res.json().error).toContain('not found')
    })
  })

  describe('POST /secrets/inject', () => {
    it('requires auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/secrets/inject',
        payload: { mappings: { DB_PASS: 'db-password' } },
      })
      expect(res.statusCode).toBe(401)
    })

    it('returns 503 when not configured', async () => {
      vi.mocked(secretsService.isConfigured).mockReturnValue(false)

      const res = await app.inject({
        method: 'POST',
        url: '/secrets/inject',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { mappings: { DB_PASS: 'db-password' } },
      })

      expect(res.statusCode).toBe(503)
    })

    it('resolves mappings and returns key-value pairs', async () => {
      vi.mocked(secretsService.isConfigured).mockReturnValue(true)
      vi.mocked(secretsService.injectSecrets).mockReturnValue({
        DB_PASS: 'resolved-password',
        API_KEY: 'resolved-key',
      })

      const res = await app.inject({
        method: 'POST',
        url: '/secrets/inject',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: {
          mappings: {
            DB_PASS: 'db-password',
            API_KEY: 'my-api-key',
          },
        },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toEqual({
        DB_PASS: 'resolved-password',
        API_KEY: 'resolved-key',
      })
      expect(secretsService.injectSecrets).toHaveBeenCalledWith({
        DB_PASS: 'db-password',
        API_KEY: 'my-api-key',
      })
    })
  })
})
