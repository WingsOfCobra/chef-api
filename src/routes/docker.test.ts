import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { FastifyInstance } from 'fastify'
import { buildApp, authHeaders } from '../test/helpers'

const mockContainers = [{ id: 'abc123', name: 'web', image: 'nginx', state: 'running' }]
const mockStats = { containers: { total: 1, running: 1, stopped: 0, paused: 0 }, images: 1, volumes: 0, diskUsage: { images: '1 MB', containers: '0 B', volumes: '0 B', buildCache: '0 B' } }

vi.mock('../services/docker.service', () => ({
  listContainers: vi.fn(async () => mockContainers),
  restartContainer: vi.fn(async () => {}),
  stopContainer: vi.fn(async () => {}),
  getContainerLogs: vi.fn(async () => 'log line 1'),
  getDockerStats: vi.fn(async () => mockStats),
}))

import dockerRoutes from './docker'
import * as docker from '../services/docker.service'

describe('docker routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      routes: [{ plugin: dockerRoutes, prefix: '/docker' }],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    app.cache.delPattern('%')
    vi.clearAllMocks()
  })

  it('GET /docker/containers returns containers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/docker/containers',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(mockContainers)
  })

  it('GET /docker/containers uses cache on second call', async () => {
    await app.inject({ method: 'GET', url: '/docker/containers', headers: authHeaders() })
    await app.inject({ method: 'GET', url: '/docker/containers', headers: authHeaders() })
    expect(vi.mocked(docker.listContainers)).toHaveBeenCalledTimes(1)
  })

  it('POST /docker/containers/:id/restart returns 204', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/docker/containers/abc123/restart',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(204)
    expect(vi.mocked(docker.restartContainer)).toHaveBeenCalledWith('abc123')
  })

  it('POST /docker/containers/:id/stop returns 204', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/docker/containers/abc123/stop',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(204)
    expect(vi.mocked(docker.stopContainer)).toHaveBeenCalledWith('abc123')
  })

  it('POST restart invalidates container cache', async () => {
    // Prime cache
    await app.inject({ method: 'GET', url: '/docker/containers', headers: authHeaders() })

    // Restart
    await app.inject({
      method: 'POST',
      url: '/docker/containers/abc123/restart',
      headers: authHeaders(),
    })

    // Next GET should hit service
    vi.mocked(docker.listContainers).mockClear()
    await app.inject({ method: 'GET', url: '/docker/containers', headers: authHeaders() })
    expect(vi.mocked(docker.listContainers)).toHaveBeenCalledTimes(1)
  })

  it('GET /docker/containers/:id/logs returns logs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/docker/containers/abc123/logs',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ id: 'abc123', lines: 100, logs: 'log line 1' })
  })

  it('GET /docker/stats returns stats', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/docker/stats',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().containers.total).toBe(1)
  })

  it('requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/docker/containers' })
    expect(res.statusCode).toBe(401)
  })
})
