import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FastifyInstance } from 'fastify'
import { buildApp, authHeaders } from '../test/helpers'
import { db } from '../db'
import cronRoutes from './cron'

// Mock ssh.service and axios to avoid real connections
vi.mock('../services/ssh.service', () => ({
  runCommand: vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', code: 0 }),
  getHost: vi.fn().mockReturnValue({ name: 'dev', user: 'deploy', host: '10.0.0.1', privateKeyPath: '~/.ssh/id_rsa' }),
  listHosts: vi.fn().mockReturnValue([]),
}))

vi.mock('axios', () => ({
  default: vi.fn().mockResolvedValue({ status: 200, data: { ok: true } }),
}))

describe('cron routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    db.prepare('DELETE FROM cron_history').run()
    db.prepare('DELETE FROM cron_jobs').run()
    app = await buildApp({ routes: [{ plugin: cronRoutes, prefix: '/cron' }] })
  })

  afterEach(async () => {
    await app.close()
  })

  describe('GET /cron/jobs', () => {
    it('returns empty list initially', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/cron/jobs',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual([])
    })

    it('requires auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/cron/jobs' })
      expect(res.statusCode).toBe(401)
    })
  })

  describe('POST /cron/jobs', () => {
    it('creates a job with preset', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/cron/jobs',
        headers: authHeaders(),
        payload: { name: 'my-disk-check', preset: 'disk-check' },
      })

      expect(res.statusCode).toBe(201)
      const body = res.json()
      expect(body.name).toBe('my-disk-check')
      expect(body.schedule).toBe('0 */6 * * *')
      expect(body.type).toBe('ssh')
    })

    it('creates a job with explicit config', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/cron/jobs',
        headers: authHeaders(),
        payload: {
          name: 'custom-job',
          schedule: '*/10 * * * *',
          type: 'http',
          config: { url: 'http://example.com/health', method: 'GET' },
        },
      })

      expect(res.statusCode).toBe(201)
      expect(res.json().type).toBe('http')
    })

    it('rejects invalid input', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/cron/jobs',
        headers: authHeaders(),
        payload: { name: 'bad' },
      })

      expect(res.statusCode).toBe(500) // Zod parse throws → 500
    })
  })

  describe('PATCH /cron/jobs/:id', () => {
    it('updates job name', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/cron/jobs',
        headers: authHeaders(),
        payload: { name: 'original-name', preset: 'disk-check' },
      })
      const id = create.json().id

      const res = await app.inject({
        method: 'PATCH',
        url: `/cron/jobs/${id}`,
        headers: authHeaders(),
        payload: { name: 'updated-name' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().name).toBe('updated-name')
      expect(res.json().id).toBe(id)
    })

    it('updates job schedule', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/cron/jobs',
        headers: authHeaders(),
        payload: { name: 'test-job', preset: 'disk-check' },
      })
      const id = create.json().id

      const res = await app.inject({
        method: 'PATCH',
        url: `/cron/jobs/${id}`,
        headers: authHeaders(),
        payload: { schedule: '*/5 * * * *' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().schedule).toBe('*/5 * * * *')
    })

    it('updates job enabled status', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/cron/jobs',
        headers: authHeaders(),
        payload: { name: 'test-job', preset: 'disk-check', enabled: true },
      })
      const id = create.json().id

      const res = await app.inject({
        method: 'PATCH',
        url: `/cron/jobs/${id}`,
        headers: authHeaders(),
        payload: { enabled: false },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().enabled).toBe(0)
    })

    it('returns 404 for nonexistent job', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/cron/jobs/999',
        headers: authHeaders(),
        payload: { name: 'does-not-matter' },
      })

      expect(res.statusCode).toBe(404)
    })
  })

  describe('DELETE /cron/jobs/:id', () => {
    it('deletes an existing job', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/cron/jobs',
        headers: authHeaders(),
        payload: { name: 'to-delete', preset: 'disk-check' },
      })
      const id = create.json().id

      const res = await app.inject({
        method: 'DELETE',
        url: `/cron/jobs/${id}`,
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(204)
    })

    it('returns 404 for nonexistent job', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/cron/jobs/999',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(404)
    })
  })

  describe('POST /cron/jobs/:id/run', () => {
    it('executes a job immediately', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/cron/jobs',
        headers: authHeaders(),
        payload: { name: 'run-now', preset: 'disk-check' },
      })
      const id = create.json().id

      const res = await app.inject({
        method: 'POST',
        url: `/cron/jobs/${id}/run`,
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().status).toBe('success')
      expect(res.json().job_id).toBe(id)
    })

    it('returns 404 for nonexistent job', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/cron/jobs/999/run',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(404)
    })
  })

  describe('GET /cron/jobs/:id/history', () => {
    it('returns execution history', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/cron/jobs',
        headers: authHeaders(),
        payload: { name: 'history-job', preset: 'disk-check' },
      })
      const id = create.json().id

      // Run the job
      await app.inject({
        method: 'POST',
        url: `/cron/jobs/${id}/run`,
        headers: authHeaders(),
      })

      const res = await app.inject({
        method: 'GET',
        url: `/cron/jobs/${id}/history`,
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(200)
      const history = res.json()
      expect(history).toHaveLength(1)
      expect(history[0].status).toBe('success')
    })
  })

  describe('GET /cron/presets', () => {
    it('returns available presets', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/cron/presets',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(200)
      const presets = res.json()
      expect(presets).toHaveProperty('disk-check')
      expect(presets).toHaveProperty('git-pull')
      expect(presets).toHaveProperty('container-health-ping')
    })
  })
})
