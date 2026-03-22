import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { FastifyInstance } from 'fastify'
import { buildApp, authHeaders } from '../test/helpers'

vi.mock('../services/ssh.service', () => ({
  getHost: vi.fn((name: string) => {
    if (name === 'dev') {
      return { name: 'dev', user: 'deploy', host: '10.0.0.1', privateKeyPath: '~/.ssh/id_rsa' }
    }
    return undefined
  }),
  runCommand: vi.fn(async () => ({
    stdout: [
      '---HOSTNAME---',
      'web-server-1',
      '---OS---',
      'Linux web-server-1 5.15.0 #1 SMP x86_64 GNU/Linux',
      '---UPTIME---',
      ' 14:30:00 up 30 days',
      '---MEMORY---',
      '              total        used        free',
      'Mem:     8589934592  4294967296  2147483648',
      '---DISK---',
      '/dev/sda1       50G   20G   28G  42% /',
      '---LOAD---',
      '0.15 0.10 0.05 1/234 5678',
    ].join('\n'),
    stderr: '',
    code: 0,
  })),
  listHosts: vi.fn(() => [{ name: 'dev', user: 'deploy', host: '10.0.0.1' }]),
}))

import fleetRoutes from './fleet'
import { db } from '../db'

describe('fleet routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      routes: [{ plugin: fleetRoutes, prefix: '/fleet' }],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    db.exec('DELETE FROM fleet_servers')
    // Clear cache between tests
    db.exec('DELETE FROM cache')
  })

  it('requires auth on GET /fleet/servers', async () => {
    const res = await app.inject({ method: 'GET', url: '/fleet/servers' })
    expect(res.statusCode).toBe(401)
  })

  it('requires auth on POST /fleet/servers', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/fleet/servers',
      headers: { 'content-type': 'application/json' },
      payload: { name: 'web1', ssh_host: 'dev' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('requires auth on DELETE /fleet/servers/:name', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/fleet/servers/web1' })
    expect(res.statusCode).toBe(401)
  })

  it('requires auth on POST /fleet/run', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/fleet/run',
      headers: { 'content-type': 'application/json' },
      payload: { command: 'uptime' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('requires auth on GET /fleet/status', async () => {
    const res = await app.inject({ method: 'GET', url: '/fleet/status' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /fleet/servers returns empty array initially', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/fleet/servers',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('POST /fleet/servers adds a server', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/fleet/servers',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { name: 'web1', ssh_host: 'dev', tags: ['web', 'prod'] },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.name).toBe('web1')
    expect(body.host).toBe('10.0.0.1')
    expect(body.user).toBe('deploy')
    expect(body.ssh_host).toBe('dev')
    expect(body.status).toBe('unknown')
  })

  it('POST /fleet/servers rejects unknown SSH host', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/fleet/servers',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { name: 'web1', ssh_host: 'nonexistent' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('not configured')
  })

  it('POST /fleet/servers rejects duplicate name', async () => {
    await app.inject({
      method: 'POST',
      url: '/fleet/servers',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { name: 'web1', ssh_host: 'dev' },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/fleet/servers',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { name: 'web1', ssh_host: 'dev' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('already exists')
  })

  it('POST /fleet/servers with invalid body returns error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/fleet/servers',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { name: '' },
    })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
  })

  it('DELETE /fleet/servers/:name removes a server', async () => {
    await app.inject({
      method: 'POST',
      url: '/fleet/servers',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { name: 'web1', ssh_host: 'dev' },
    })

    const res = await app.inject({
      method: 'DELETE',
      url: '/fleet/servers/web1',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(204)
  })

  it('DELETE /fleet/servers/:name returns 404 for non-existent', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/fleet/servers/nonexistent',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST /fleet/run executes command on fleet servers', async () => {
    // Add a server first
    await app.inject({
      method: 'POST',
      url: '/fleet/servers',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { name: 'web1', ssh_host: 'dev' },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/fleet/run',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { command: 'uptime' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(1)
    expect(body[0].server).toBe('web1')
    expect(body[0].code).toBe(0)
  })

  it('POST /fleet/run with selected servers', async () => {
    await app.inject({
      method: 'POST',
      url: '/fleet/servers',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { name: 'web1', ssh_host: 'dev' },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/fleet/run',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { command: 'ls', servers: ['web1'] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('POST /fleet/run with invalid body returns error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/fleet/run',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { command: '' },
    })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
  })

  it('GET /fleet/status returns fleet health', async () => {
    await app.inject({
      method: 'POST',
      url: '/fleet/servers',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { name: 'web1', ssh_host: 'dev' },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/fleet/status',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(1)
    expect(body[0].name).toBe('web1')
    expect(body[0].status).toBe('online')
    expect(body[0].info).toBeDefined()
    expect(body[0].info.hostname).toBe('web-server-1')
    expect(body[0].responseTimeMs).toBeGreaterThanOrEqual(0)
  })

  it('GET /fleet/status returns empty array when no servers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/fleet/status',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })
})
