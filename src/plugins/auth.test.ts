import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp, authHeaders, TEST_API_KEY } from '../test/helpers'
import { FastifyInstance } from 'fastify'

describe('auth plugin', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      routes: [
        {
          plugin: async (fastify) => {
            fastify.get('/', async () => ({ ok: true }))
          },
          prefix: '/test',
        },
        {
          plugin: async (fastify) => {
            fastify.get('/health', async () => ({ status: 'ok' }))
          },
          prefix: '/system',
        },
      ],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns 401 without API key header', async () => {
    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('Unauthorized')
  })

  it('returns 401 with wrong API key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-chef-api-key': 'wrong-key' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 200 with correct API key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('bypasses auth for /system/health', async () => {
    const res = await app.inject({ method: 'GET', url: '/system/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })
})
