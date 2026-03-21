import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
import { FastifyInstance } from 'fastify'
import { buildApp, authHeaders } from '../test/helpers'
import { execSync } from 'child_process'

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}))

const mockExecSync = vi.mocked(execSync)

import servicesRoutes from './services'

describe('services routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      routes: [{ plugin: servicesRoutes, prefix: '/services' }],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  it('GET /services/status returns empty when no services configured', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/services/status',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.services).toEqual([])
    expect(body.timestamp).toBeDefined()
  })

  it('requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/services/status' })
    expect(res.statusCode).toBe(401)
  })
})
