import { describe, it, expect, afterEach } from 'vitest'
import { buildApp, authHeaders, TEST_API_KEY } from './helpers'
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'

const testRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get('/ping', async () => ({ ok: true }))
}

describe('test helpers', () => {
  describe('buildApp', () => {
    let app: FastifyInstance | null = null

    afterEach(async () => {
      if (app) await app.close()
      app = null
    })

    it('creates a Fastify instance with cache and auth', async () => {
      app = await buildApp()

      expect(app.cache).toBeDefined()
      expect(app.cache.get).toBeTypeOf('function')
      expect(app.cache.set).toBeTypeOf('function')
      expect(app.authenticate).toBeTypeOf('function')
    })

    it('rejects requests without API key', async () => {
      app = await buildApp({ routes: [{ plugin: testRoute, prefix: '/test' }] })

      const res = await app.inject({ method: 'GET', url: '/test/ping' })
      expect(res.statusCode).toBe(401)
    })

    it('accepts requests with correct API key', async () => {
      app = await buildApp({ routes: [{ plugin: testRoute, prefix: '/test' }] })

      const res = await app.inject({
        method: 'GET',
        url: '/test/ping',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ ok: true })
    })

    it('cache set/get works correctly', async () => {
      app = await buildApp()

      app.cache.set('test:key', { data: 42 }, 60)
      const result = app.cache.get('test:key')
      expect(result).toEqual({ data: 42 })
    })
  })

  describe('authHeaders', () => {
    it('returns headers with the test API key', () => {
      const headers = authHeaders()
      expect(headers['x-chef-api-key']).toBe(TEST_API_KEY)
    })
  })
})
