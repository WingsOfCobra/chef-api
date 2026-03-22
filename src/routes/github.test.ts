import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { FastifyInstance } from 'fastify'
import { buildApp, authHeaders } from '../test/helpers'

const mockRepos = [{ name: 'repo1', fullName: 'user/repo1' }]
const mockIssue = { number: 1, title: 'Bug', author: 'dev', createdAt: '2025-01-01', labels: [], url: 'https://github.com', state: 'open' }

const mockRepoDetail = {
  name: 'chef-api', fullName: 'user/chef-api', description: 'API', stars: 10, forks: 3,
  watchers: 8, openIssues: 5, size: 2048, defaultBranch: 'main', language: 'TypeScript',
  topics: ['api'], license: 'MIT', visibility: 'public', createdAt: '2024-01-01',
  updatedAt: '2025-01-01', pushedAt: '2025-01-15', url: 'https://github.com/user/chef-api', private: false,
}
const mockBranches = [{ name: 'main', protected: true, sha: 'abc123' }]
const mockCommits = [{ sha: 'abc123', message: 'init', author: 'dev', date: '2025-01-01', url: 'https://github.com' }]
const mockReleases = [{ id: 1, tagName: 'v1.0.0', name: 'First', draft: false, prerelease: false, createdAt: '2025-01-01', publishedAt: '2025-01-01', author: 'dev', url: 'https://github.com' }]

vi.mock('../services/github.service', () => ({
  listRepos: vi.fn(async () => mockRepos),
  listPRs: vi.fn(async () => []),
  listIssues: vi.fn(async () => [mockIssue]),
  createIssue: vi.fn(async () => mockIssue),
  listWorkflowRuns: vi.fn(async () => []),
  listNotifications: vi.fn(async () => []),
  getRepoDetail: vi.fn(async () => mockRepoDetail),
  listBranches: vi.fn(async () => mockBranches),
  listCommits: vi.fn(async () => mockCommits),
  listReleases: vi.fn(async () => mockReleases),
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

  // --- New endpoint tests ---

  it('GET /github/repos/:owner/:repo returns repo detail', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/github/repos/user/chef-api',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('chef-api')
    expect(res.json().language).toBe('TypeScript')
    expect(res.json().topics).toEqual(['api'])
    expect(vi.mocked(github.getRepoDetail)).toHaveBeenCalledWith('user', 'chef-api')
  })

  it('GET /github/repos/:owner/:repo caches on second call', async () => {
    await app.inject({ method: 'GET', url: '/github/repos/user/chef-api', headers: authHeaders() })
    await app.inject({ method: 'GET', url: '/github/repos/user/chef-api', headers: authHeaders() })
    expect(vi.mocked(github.getRepoDetail)).toHaveBeenCalledTimes(1)
  })

  it('GET /github/repos/:owner/:repo/branches returns branches', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/github/repos/user/repo/branches',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(mockBranches)
  })

  it('GET /github/repos/:owner/:repo/branches caches on second call', async () => {
    await app.inject({ method: 'GET', url: '/github/repos/user/repo/branches', headers: authHeaders() })
    await app.inject({ method: 'GET', url: '/github/repos/user/repo/branches', headers: authHeaders() })
    expect(vi.mocked(github.listBranches)).toHaveBeenCalledTimes(1)
  })

  it('GET /github/repos/:owner/:repo/commits returns commits', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/github/repos/user/repo/commits',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
    expect(res.json()[0].sha).toBe('abc123')
  })

  it('GET /github/repos/:owner/:repo/commits forwards query params', async () => {
    await app.inject({
      method: 'GET',
      url: '/github/repos/user/repo/commits?sha=develop&per_page=5',
      headers: authHeaders(),
    })
    expect(vi.mocked(github.listCommits)).toHaveBeenCalledWith('user', 'repo', 'develop', 5)
  })

  it('GET /github/repos/:owner/:repo/commits uses defaults when no query params', async () => {
    await app.inject({
      method: 'GET',
      url: '/github/repos/user/repo/commits',
      headers: authHeaders(),
    })
    expect(vi.mocked(github.listCommits)).toHaveBeenCalledWith('user', 'repo', undefined, 20)
  })

  it('GET /github/repos/:owner/:repo/releases returns releases', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/github/repos/user/repo/releases',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
    expect(res.json()[0].tagName).toBe('v1.0.0')
  })

  it('GET /github/repos/:owner/:repo/releases caches on second call', async () => {
    await app.inject({ method: 'GET', url: '/github/repos/user/repo/releases', headers: authHeaders() })
    await app.inject({ method: 'GET', url: '/github/repos/user/repo/releases', headers: authHeaders() })
    expect(vi.mocked(github.listReleases)).toHaveBeenCalledTimes(1)
  })

  it('requires auth for all endpoints', async () => {
    const res = await app.inject({ method: 'GET', url: '/github/repos' })
    expect(res.statusCode).toBe(401)
  })
})
