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

const mockDetailedRepoInfo = {
  name: 'chef-api',
  fullName: 'user/chef-api',
  description: 'API',
  stars: 10,
  forks: 3,
  watchers: 8,
  openIssues: 5,
  openPRs: 2,
  defaultBranch: 'main',
  language: 'TypeScript',
  url: 'https://github.com/user/chef-api',
  private: false,
  languages: { TypeScript: 8000, JavaScript: 2000 },
  recentCommits: mockCommits,
  topContributors: [{ login: 'dev1', contributions: 50, avatarUrl: 'https://github.com/dev1.png' }],
  latestRelease: mockReleases[0],
}

const mockDetailedPRInfo = {
  number: 1,
  title: 'Add feature',
  body: 'PR description',
  author: 'dev',
  state: 'open',
  draft: false,
  createdAt: '2025-01-01',
  updatedAt: '2025-01-02',
  mergedAt: null,
  url: 'https://github.com/user/repo/pull/1',
  filesChanged: 5,
  additions: 100,
  deletions: 20,
  commits: 3,
  reviewStatus: { approved: 1, changesRequested: 0, commented: 0, pending: 0 },
  ciStatus: { conclusion: 'success', checks: [{ name: 'CI', conclusion: 'success', status: 'completed' }] },
}

const mockWorkflowRunLogs = {
  runId: 123,
  runName: 'CI',
  status: 'completed',
  conclusion: 'success',
  jobs: [
    {
      id: 1,
      name: 'build',
      status: 'completed',
      conclusion: 'success',
      startedAt: '2025-01-01T10:00:00Z',
      completedAt: '2025-01-01T10:05:00Z',
      steps: [{ name: 'Checkout', status: 'completed', conclusion: 'success', number: 1 }],
    },
  ],
}

const mockEnhancedWorkflowRuns = [
  {
    id: 123,
    name: 'CI',
    status: 'completed',
    conclusion: 'success',
    createdAt: '2025-01-01T10:00:00Z',
    url: 'https://github.com/user/repo/actions/runs/123',
    branch: 'main',
    duration: 300,
    triggeringCommit: { sha: 'abc123', message: 'init', author: 'dev' },
  },
]

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
  getDetailedRepoInfo: vi.fn(async () => mockDetailedRepoInfo),
  getDetailedPRInfo: vi.fn(async () => mockDetailedPRInfo),
  getWorkflowRunLogs: vi.fn(async () => mockWorkflowRunLogs),
  listEnhancedWorkflowRuns: vi.fn(async () => mockEnhancedWorkflowRuns),
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

  it('GET /github/repos/:owner/:repo returns detailed repo info', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/github/repos/user/chef-api',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const data = res.json()
    expect(data.name).toBe('chef-api')
    expect(data.language).toBe('TypeScript')
    expect(data.languages).toEqual({ TypeScript: 8000, JavaScript: 2000 })
    expect(data.recentCommits).toHaveLength(1)
    expect(data.topContributors).toHaveLength(1)
    expect(data.latestRelease.tagName).toBe('v1.0.0')
    expect(vi.mocked(github.getDetailedRepoInfo)).toHaveBeenCalledWith('user', 'chef-api')
  })

  it('GET /github/repos/:owner/:repo caches on second call', async () => {
    await app.inject({ method: 'GET', url: '/github/repos/user/chef-api', headers: authHeaders() })
    await app.inject({ method: 'GET', url: '/github/repos/user/chef-api', headers: authHeaders() })
    expect(vi.mocked(github.getDetailedRepoInfo)).toHaveBeenCalledTimes(1)
  })

  it('GET /github/repos/:owner/:repo/pulls/:pull_number returns detailed PR info', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/github/repos/user/repo/pulls/1',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const data = res.json()
    expect(data.number).toBe(1)
    expect(data.filesChanged).toBe(5)
    expect(data.additions).toBe(100)
    expect(data.deletions).toBe(20)
    expect(data.reviewStatus.approved).toBe(1)
    expect(data.ciStatus.conclusion).toBe('success')
    expect(vi.mocked(github.getDetailedPRInfo)).toHaveBeenCalledWith('user', 'repo', 1)
  })

  it('GET /github/repos/:owner/:repo/pulls/:pull_number caches on second call', async () => {
    await app.inject({ method: 'GET', url: '/github/repos/user/repo/pulls/1', headers: authHeaders() })
    await app.inject({ method: 'GET', url: '/github/repos/user/repo/pulls/1', headers: authHeaders() })
    expect(vi.mocked(github.getDetailedPRInfo)).toHaveBeenCalledTimes(1)
  })

  it('GET /github/repos/:owner/:repo/runs/:run_id/logs returns workflow run logs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/github/repos/user/repo/runs/123/logs',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const data = res.json()
    expect(data.runId).toBe(123)
    expect(data.jobs).toHaveLength(1)
    expect(data.jobs[0].name).toBe('build')
    expect(data.jobs[0].steps).toHaveLength(1)
    expect(vi.mocked(github.getWorkflowRunLogs)).toHaveBeenCalledWith('user', 'repo', 123)
  })

  it('GET /github/repos/:owner/:repo/runs/:run_id/logs caches on second call', async () => {
    await app.inject({ method: 'GET', url: '/github/repos/user/repo/runs/123/logs', headers: authHeaders() })
    await app.inject({ method: 'GET', url: '/github/repos/user/repo/runs/123/logs', headers: authHeaders() })
    expect(vi.mocked(github.getWorkflowRunLogs)).toHaveBeenCalledTimes(1)
  })

  it('GET /github/repos/:owner/:repo/workflows returns enhanced workflow runs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/github/repos/user/repo/workflows',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const data = res.json()
    expect(data).toHaveLength(1)
    expect(data[0].duration).toBe(300)
    expect(data[0].triggeringCommit.sha).toBe('abc123')
    expect(vi.mocked(github.listEnhancedWorkflowRuns)).toHaveBeenCalledWith('user', 'repo')
  })

  it('GET /github/repos/:owner/:repo/workflows caches on second call', async () => {
    await app.inject({ method: 'GET', url: '/github/repos/user/repo/workflows', headers: authHeaders() })
    await app.inject({ method: 'GET', url: '/github/repos/user/repo/workflows', headers: authHeaders() })
    expect(vi.mocked(github.listEnhancedWorkflowRuns)).toHaveBeenCalledTimes(1)
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
