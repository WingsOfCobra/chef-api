import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { FastifyInstance } from 'fastify'
import { buildApp } from '../test/helpers'
import { errorRing } from '../lib/error-ring'
import systemRoutes from './system'

describe('GET /system/health', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    errorRing.clear()
    if (app) await app.close()
    app = await buildApp({
      routes: [{ plugin: systemRoutes, prefix: '/system' }],
      skipAuth: true,
    })
  })

  afterAll(async () => {
    if (app) await app.close()
  })

  it('should return health status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/system/health',
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body).toHaveProperty('status')
    expect(body).toHaveProperty('uptime')
    expect(body).toHaveProperty('cpu')
    expect(body).toHaveProperty('memory')
    expect(body).toHaveProperty('recentErrors')
    expect(Array.isArray(body.recentErrors)).toBe(true)
  })

  it('should include recentErrors when errors exist', async () => {
    // Clear cache explicitly
    app.cache.del('system:health')
    
    errorRing.add({
      timestamp: new Date().toISOString(),
      service: 'docker',
      message: 'Test error',
    })

    const response = await app.inject({
      method: 'GET',
      url: '/system/health',
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.recentErrors.length).toBeGreaterThanOrEqual(1)
    expect(body.recentErrors[0].service).toBe('docker')
    expect(body.recentErrors[0].message).toBe('Test error')
  })

  it('should return empty recentErrors when no errors', async () => {
    // Clear cache explicitly
    app.cache.del('system:health')
    
    const response = await app.inject({
      method: 'GET',
      url: '/system/health',
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.recentErrors).toEqual([])
  })

  it('should limit recentErrors to 5', async () => {
    // Clear cache explicitly
    app.cache.del('system:health')
    
    for (let i = 0; i < 10; i++) {
      errorRing.add({
        timestamp: new Date().toISOString(),
        service: 'test',
        message: `Error ${i}`,
      })
    }

    const response = await app.inject({
      method: 'GET',
      url: '/system/health',
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.recentErrors).toHaveLength(5)
  })
})
