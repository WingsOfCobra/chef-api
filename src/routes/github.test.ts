import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { FastifyInstance } from 'fastify'
import { buildApp, authHeaders } from '../test/helpers'

const mockRepos = [{ name: 'repo1', fullName: 'user/repo1' }]
const mockIssue = { number: 1, title: 'Bug', author: 'dev', createdAt: '2025-01-01', labels: [], url: 'https://github.com', state: 'open' }

vi.mock('../services/github.service', () => ({
  listRepos: vi.fn(async () => mockRepos),
  listPRs: vi.fn(async () => []),
  listIssues: vi.fn(async () => [mockIssue]),
  createIssue: vi.fn(async () => mockIssue),
  listWorkflowRuns: vi.fn(async () => []),
  listNotifications: vi.fn(async () => []),
}))

import githubRoutes from './github'
import * as github from '../services/github.service'

describe('github routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      routes: [{ plugin: githubRoutes, prefix: '/github' }],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    app.cache.delPattern('%')
    vi.clearAllMocks()
  })

  it('GET /github/repos returns repos', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/github/repos',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(mockRepos)
  })

  it('GET /github/repos returns cached data on second call', async () => {
    await app.inject({ method: 'GET', url: '/github/repos', headers: authHeaders() })
    await app.inject({ method: 'GET', url: '/github/repos', headers: authHeaders() })

    expect(vi.mocked(github.listRepos)).toHaveBeenCalledTimes(1)
  })

  it('POST /github/repos/:owner/:repo/issues creates issue and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/github/repos/user/repo/issues',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { title: 'New bug' },
    })
    expect(res.statusCode).toBe(201)
    expect(vi.mocked(github.createIssue)).toHaveBeenCalledWith('user', 'repo', 'New bug', undefined, undefined)
  })

  it('POST /github/repos/:owner/:repo/issues invalidates cache', async () => {
    // Prime cache
    await app.inject({
      method: 'GET',
      url: '/github/repos/user/repo/issues',
      headers: authHeaders(),
    })

    // Create issue (should invalidate)
    await app.inject({
      method: 'POST',
      url: '/github/repos/user/repo/issues',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { title: 'Bug' },
    })

    // Next GET should hit service again
    vi.mocked(github.listIssues).mockClear()
    await app.inject({
      method: 'GET',
      url: '/github/repos/user/repo/issues',
      headers: authHeaders(),
    })
    expect(vi.mocked(github.listIssues)).toHaveBeenCalledTimes(1)
  })

  it('GET /github/notifications returns notifications', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/github/notifications',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
  })

  it('requires auth for all endpoints', async () => {
    const res = await app.inject({ method: 'GET', url: '/github/repos' })
    expect(res.statusCode).toBe(401)
  })
})
