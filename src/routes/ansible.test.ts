import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { FastifyInstance } from 'fastify'
import { buildApp, authHeaders } from '../test/helpers'
import ansibleRoutes from './ansible'
import { db } from '../db'

// Mock the ansible service
vi.mock('../services/ansible.service', () => ({
  listPlaybooks: vi.fn().mockReturnValue(['deploy.yml', 'setup.yaml', 'backup.yml']),
  playbookExists: vi.fn().mockImplementation((name: string) => {
    return ['deploy.yml', 'setup.yaml', 'backup.yml'].includes(name)
  }),
  runPlaybook: vi.fn().mockImplementation((name: string) => ({
    id: 1,
    playbook: name,
    status: 'running',
    output: null,
    exit_code: null,
    started_at: '2026-03-22T00:00:00.000Z',
    finished_at: null,
    created_at: '2026-03-22T00:00:00.000Z',
  })),
  getJob: vi.fn().mockImplementation((id: number) => {
    if (id === 999) return undefined
    return {
      id,
      playbook: 'deploy.yml',
      status: 'success',
      output: 'PLAY [all] ***\nok',
      exit_code: 0,
      started_at: '2026-03-22T00:00:00.000Z',
      finished_at: '2026-03-22T00:00:01.000Z',
      created_at: '2026-03-22T00:00:00.000Z',
    }
  }),
  listJobs: vi.fn().mockReturnValue([
    {
      id: 1,
      playbook: 'deploy.yml',
      status: 'success',
      output: 'ok',
      exit_code: 0,
      started_at: '2026-03-22T00:00:00.000Z',
      finished_at: '2026-03-22T00:00:01.000Z',
      created_at: '2026-03-22T00:00:00.000Z',
    },
  ]),
  getInventory: vi.fn().mockReturnValue('[all]\nlocalhost'),
}))

// Mock config - start with ansible not configured
const mockConfig = {
  ansiblePlaybookDir: '',
  ansibleInventory: '',
}

vi.mock('../config', () => ({
  config: new Proxy({} as Record<string, unknown>, {
    get(_target, prop: string) {
      if (prop in mockConfig) return (mockConfig as Record<string, unknown>)[prop]
      // Return defaults for other config props used by plugins
      if (prop === 'apiKey') return 'test-api-key-12345'
      return ''
    },
  }),
}))

describe('ansible routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      routes: [{ plugin: ansibleRoutes, prefix: '/ansible' }],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('auth', () => {
    it('requires auth on GET /ansible/playbooks', async () => {
      const res = await app.inject({ method: 'GET', url: '/ansible/playbooks' })
      expect(res.statusCode).toBe(401)
    })

    it('requires auth on POST /ansible/playbooks/deploy.yml/run', async () => {
      const res = await app.inject({ method: 'POST', url: '/ansible/playbooks/deploy.yml/run' })
      expect(res.statusCode).toBe(401)
    })

    it('requires auth on GET /ansible/jobs', async () => {
      const res = await app.inject({ method: 'GET', url: '/ansible/jobs' })
      expect(res.statusCode).toBe(401)
    })

    it('requires auth on GET /ansible/jobs/1', async () => {
      const res = await app.inject({ method: 'GET', url: '/ansible/jobs/1' })
      expect(res.statusCode).toBe(401)
    })

    it('requires auth on GET /ansible/inventory', async () => {
      const res = await app.inject({ method: 'GET', url: '/ansible/inventory' })
      expect(res.statusCode).toBe(401)
    })
  })

  describe('503 when not configured', () => {
    beforeEach(() => {
      mockConfig.ansiblePlaybookDir = ''
      mockConfig.ansibleInventory = ''
    })

    it('GET /ansible/playbooks returns 503', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ansible/playbooks',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(503)
      expect(res.json().error).toContain('not configured')
    })

    it('POST /ansible/playbooks/:name/run returns 503', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/ansible/playbooks/deploy.yml/run',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(503)
    })

    it('GET /ansible/inventory returns 503', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ansible/inventory',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(503)
    })
  })

  describe('when configured', () => {
    beforeEach(() => {
      mockConfig.ansiblePlaybookDir = '/opt/playbooks'
      mockConfig.ansibleInventory = '/opt/inventory.ini'
      // Clear cache between tests
      fastify_cache_clear(app)
    })

    it('GET /ansible/playbooks lists playbooks', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ansible/playbooks',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.playbooks).toEqual(['deploy.yml', 'setup.yaml', 'backup.yml'])
    })

    it('POST /ansible/playbooks/:name/run starts a job', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/ansible/playbooks/deploy.yml/run',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(202)
      const body = res.json()
      expect(body.id).toBe(1)
      expect(body.playbook).toBe('deploy.yml')
      expect(body.status).toBe('running')
    })

    it('POST /ansible/playbooks/:name/run returns 404 for unknown playbook', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/ansible/playbooks/nonexistent.yml/run',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(404)
      expect(res.json().error).toContain('not found')
    })

    it('GET /ansible/jobs/:id returns job', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ansible/jobs/1',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.id).toBe(1)
      expect(body.playbook).toBe('deploy.yml')
      expect(body.status).toBe('success')
    })

    it('GET /ansible/jobs/:id returns 404 for unknown job', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ansible/jobs/999',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(404)
    })

    it('GET /ansible/jobs lists recent jobs', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ansible/jobs',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.jobs).toHaveLength(1)
      expect(body.jobs[0].playbook).toBe('deploy.yml')
    })

    it('GET /ansible/jobs accepts limit query', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ansible/jobs?limit=5',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(200)
    })

    it('GET /ansible/inventory returns inventory content', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ansible/inventory',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().inventory).toBe('[all]\nlocalhost')
    })
  })
})

// Helper to clear cache between tests
function fastify_cache_clear(app: FastifyInstance) {
  try {
    app.cache.delPattern('ansible:%')
  } catch {
    // Cache might not have ansible keys yet
  }
}
