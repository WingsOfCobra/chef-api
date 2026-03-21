import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
import { FastifyInstance } from 'fastify'
import { buildApp, authHeaders } from '../test/helpers'

vi.mock('../services/ssh.service', () => ({
  listHosts: vi.fn(() => [{ name: 'dev', user: 'deploy', host: '10.0.0.1' }]),
  runCommand: vi.fn(async () => ({ stdout: 'output', stderr: '', code: 0 })),
}))

import sshRoutes from './ssh'
import * as ssh from '../services/ssh.service'

describe('ssh routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      routes: [{ plugin: sshRoutes, prefix: '/ssh' }],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  it('GET /ssh/hosts returns host list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ssh/hosts',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([{ name: 'dev', user: 'deploy', host: '10.0.0.1' }])
  })

  it('POST /ssh/run executes command and returns result', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ssh/run',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { host: 'dev', command: 'ls -la' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ stdout: 'output', stderr: '', code: 0 })
    expect(vi.mocked(ssh.runCommand)).toHaveBeenCalledWith('dev', 'ls -la')
  })

  it('POST /ssh/run with invalid body returns error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ssh/run',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { host: '', command: '' },
    })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
  })

  it('requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/ssh/hosts' })
    expect(res.statusCode).toBe(401)
  })
})
