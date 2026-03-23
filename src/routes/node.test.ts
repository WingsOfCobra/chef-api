import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import authPlugin from '../plugins/auth'
import { config } from '../config'

describe('node mode', () => {
  let app: FastifyInstance

  describe('master mode (default)', () => {
    beforeEach(async () => {
      // Temporarily override config to test master mode
      vi.spyOn(config, 'nodeMode', 'get').mockReturnValue(false)
      
      app = Fastify({ logger: false })
      await app.register(authPlugin)

      // Simulate /node/info endpoint
      app.get('/node/info', async () => {
        const os = require('os')
        return {
          mode: config.nodeMode ? 'node' : 'master',
          version: '0.1.0',
          hostname: os.hostname(),
          uptime: os.uptime(),
        }
      })

      // Simulate a master-only route
      app.get('/github/repos', async () => {
        return { repos: [] }
      })
    })

    afterEach(async () => {
      await app.close()
      vi.restoreAllMocks()
    })

    it('reports mode as master', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/node/info',
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.mode).toBe('master')
      expect(body.version).toBe('0.1.0')
      expect(body.hostname).toBeTypeOf('string')
      expect(body.uptime).toBeTypeOf('number')
    })

    it('allows master-only routes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/github/repos',
        headers: { 'X-Chef-API-Key': config.apiKey },
      })

      expect(res.statusCode).toBe(200)
    })
  })

  describe('node mode', () => {
    beforeEach(async () => {
      // Temporarily override config to test node mode
      vi.spyOn(config, 'nodeMode', 'get').mockReturnValue(true)

      app = Fastify({ logger: false })
      await app.register(authPlugin)

      // Node mode filter hook
      const allowedPrefixes = ['/system', '/docker', '/services', '/metrics', '/node']
      app.addHook('onRequest', async (request, reply) => {
        if (request.url === '/system/health' || request.url.startsWith('/docs')) {
          return
        }
        const isAllowed = allowedPrefixes.some(prefix => request.url.startsWith(prefix))
        if (!isAllowed) {
          reply.code(503).send({ error: 'Not available in node mode' })
        }
      })

      // Simulate /node/info endpoint
      app.get('/node/info', async () => {
        const os = require('os')
        return {
          mode: config.nodeMode ? 'node' : 'master',
          version: '0.1.0',
          hostname: os.hostname(),
          uptime: os.uptime(),
        }
      })

      // Simulate allowed routes
      app.get('/system/cpu', async () => {
        return { usage: 23.5 }
      })

      // Simulate disallowed routes
      app.get('/github/repos', async () => {
        return { repos: [] }
      })
    })

    afterEach(async () => {
      await app.close()
      vi.restoreAllMocks()
    })

    it('reports mode as node', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/node/info',
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.mode).toBe('node')
    })

    it('allows system metrics routes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/system/cpu',
        headers: { 'X-Chef-API-Key': config.apiKey },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().usage).toBe(23.5)
    })

    it('blocks disallowed routes with 503', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/github/repos',
        headers: { 'X-Chef-API-Key': config.apiKey },
      })

      expect(res.statusCode).toBe(503)
      expect(res.json().error).toBe('Not available in node mode')
    })

    it('blocks /todo routes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/todo',
        headers: { 'X-Chef-API-Key': config.apiKey },
      })

      expect(res.statusCode).toBe(503)
    })

    it('blocks /cron routes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/cron/jobs',
        headers: { 'X-Chef-API-Key': config.apiKey },
      })

      expect(res.statusCode).toBe(503)
    })

    it('blocks /alerts routes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/alerts/rules',
        headers: { 'X-Chef-API-Key': config.apiKey },
      })

      expect(res.statusCode).toBe(503)
    })
  })
})
