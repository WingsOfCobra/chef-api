import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
import { FastifyInstance } from 'fastify'
import { buildApp, authHeaders } from '../test/helpers'
import metricsRoutes from './metrics'

vi.mock('../services/metrics.service', () => ({
  getPrometheusText: vi.fn().mockResolvedValue(
    '# HELP chef_cpu_usage_percent Current CPU usage percentage\n# TYPE chef_cpu_usage_percent gauge\nchef_cpu_usage_percent 45.2\n'
  ),
  getMetricsSnapshot: vi.fn().mockResolvedValue({
    cpu: { usage_percent: 45.2, cores: 4, load_avg: [0.5, 0.3, 0.2] },
    memory: { total_bytes: 17179869184, used_percent: 50 },
    disk: [{ mountpoint: '/', use_percent: 42 }],
    containers: { running: 2, stopped: 1, paused: 0 },
    ssh_jobs: { total: 45, success: 42, error: 3 },
    timestamp: '2024-01-01T00:00:00.000Z',
  }),
}))

describe('metrics routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      routes: [{ plugin: metricsRoutes, prefix: '/metrics' }],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  it('requires auth for GET /metrics', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' })
    expect(res.statusCode).toBe(401)
  })

  it('requires auth for GET /metrics/snapshot', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics/snapshot' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /metrics returns text/plain Prometheus format', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/plain')
    expect(res.payload).toContain('chef_cpu_usage_percent')
  })

  it('GET /metrics/snapshot returns JSON', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/metrics/snapshot',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty('cpu')
    expect(body).toHaveProperty('memory')
    expect(body).toHaveProperty('disk')
    expect(body).toHaveProperty('containers')
    expect(body).toHaveProperty('ssh_jobs')
    expect(body).toHaveProperty('timestamp')
    expect(body.cpu.usage_percent).toBe(45.2)
    expect(body.containers.running).toBe(2)
    expect(body.ssh_jobs.total).toBe(45)
  })

  it('GET /metrics uses cache on second call', async () => {
    const { getPrometheusText } = await import('../services/metrics.service')
    vi.mocked(getPrometheusText).mockClear()

    // Bust cache so we start fresh
    app.cache.del('metrics:prometheus')

    // First call — populates cache
    await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: authHeaders(),
    })
    expect(getPrometheusText).toHaveBeenCalledTimes(1)

    // Second call — should use cache, not call service again
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect(getPrometheusText).toHaveBeenCalledTimes(1)
  })
})
