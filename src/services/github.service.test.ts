import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockOctokit = {
  repos: {
    listForAuthenticatedUser: vi.fn(),
    listForOrg: vi.fn(),
    get: vi.fn(),
    listBranches: vi.fn(),
    listCommits: vi.fn(),
    listReleases: vi.fn(),
  },
  pulls: { list: vi.fn() },
  checks: { listForRef: vi.fn() },
  issues: { listForRepo: vi.fn(), create: vi.fn() },
  actions: { listWorkflowRunsForRepo: vi.fn() },
  activity: { listNotificationsForAuthenticatedUser: vi.fn() },
}

vi.mock('@octokit/rest', () => ({
  Octokit: class {
    repos = mockOctokit.repos
    pulls = mockOctokit.pulls
    checks = mockOctokit.checks
    issues = mockOctokit.issues
    actions = mockOctokit.actions
    activity = mockOctokit.activity
  },
}))

import {
  listRepos,
  listPRs,
  listIssues,
  createIssue,
  listWorkflowRuns,
  listNotifications,
  getRepoDetail,
  listBranches,
  listCommits,
  listReleases,
} from './github.service'

const fakeRepo = {
  name: 'my-repo',
  full_name: 'user/my-repo',
  description: 'A test repo',
  stargazers_count: 42,
  pushed_at: '2025-01-01T00:00:00Z',
  open_issues_count: 3,
  html_url: 'https://github.com/user/my-repo',
  private: false,
}

describe('github.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('listRepos', () => {
    it('calls listForAuthenticatedUser when no org provided', async () => {
      mockOctokit.repos.listForAuthenticatedUser.mockResolvedValue({ data: [fakeRepo] })

      const repos = await listRepos()

      expect(mockOctokit.repos.listForAuthenticatedUser).toHaveBeenCalledWith({
        sort: 'pushed',
        per_page: 50,
      })
      expect(repos).toHaveLength(1)
      expect(repos[0]).toEqual({
        name: 'my-repo',
        fullName: 'user/my-repo',
        description: 'A test repo',
        stars: 42,
        lastPush: '2025-01-01T00:00:00Z',
        openIssues: 3,
        url: 'https://github.com/user/my-repo',
        private: false,
      })
    })

    it('calls listForOrg when org is provided', async () => {
      mockOctokit.repos.listForOrg.mockResolvedValue({ data: [fakeRepo] })

      await listRepos('myorg')

      expect(mockOctokit.repos.listForOrg).toHaveBeenCalledWith({
        org: 'myorg',
        sort: 'pushed',
        per_page: 50,
      })
    })
  })

  describe('listPRs', () => {
    const fakePR = {
      number: 1,
      title: 'Fix bug',
      user: { login: 'dev' },
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-02T00:00:00Z',
      html_url: 'https://github.com/user/repo/pull/1',
      draft: false,
      head: { sha: 'abc123' },
    }

    it('derives ciStatus from check conclusions', async () => {
      mockOctokit.pulls.list.mockResolvedValue({ data: [fakePR] })
      mockOctokit.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            { conclusion: 'success', status: 'completed' },
            { conclusion: 'success', status: 'completed' },
          ],
        },
      })

      const prs = await listPRs('user', 'repo')

      expect(prs).toHaveLength(1)
      expect(prs[0].ciStatus).toBe('success')
    })

    it('returns failure if any check failed', async () => {
      mockOctokit.pulls.list.mockResolvedValue({ data: [fakePR] })
      mockOctokit.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            { conclusion: 'success', status: 'completed' },
            { conclusion: 'failure', status: 'completed' },
          ],
        },
      })

      const prs = await listPRs('user', 'repo')
      expect(prs[0].ciStatus).toBe('failure')
    })

    it('returns pending for in_progress checks', async () => {
      mockOctokit.pulls.list.mockResolvedValue({ data: [fakePR] })
      mockOctokit.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [{ conclusion: null, status: 'in_progress' }],
        },
      })

      const prs = await listPRs('user', 'repo')
      expect(prs[0].ciStatus).toBe('pending')
    })

    it('sets ciStatus to null when check API fails', async () => {
      mockOctokit.pulls.list.mockResolvedValue({ data: [fakePR] })
      mockOctokit.checks.listForRef.mockRejectedValue(new Error('API error'))

      const prs = await listPRs('user', 'repo')
      expect(prs[0].ciStatus).toBeNull()
    })
  })

  describe('listIssues', () => {
    it('filters out pull requests', async () => {
      mockOctokit.issues.listForRepo.mockResolvedValue({
        data: [
          {
            number: 1,
            title: 'Bug',
            user: { login: 'dev' },
            created_at: '2025-01-01T00:00:00Z',
            labels: [{ name: 'bug' }],
            html_url: 'https://github.com/user/repo/issues/1',
            state: 'open',
          },
          {
            number: 2,
            title: 'PR pretending to be issue',
            user: { login: 'dev' },
            created_at: '2025-01-01T00:00:00Z',
            labels: [],
            html_url: 'https://github.com/user/repo/issues/2',
            state: 'open',
            pull_request: { url: 'https://api.github.com/repos/user/repo/pulls/2' },
          },
        ],
      })

      const issues = await listIssues('user', 'repo')

      expect(issues).toHaveLength(1)
      expect(issues[0].number).toBe(1)
      expect(issues[0].labels).toEqual(['bug'])
    })

    it('handles string labels', async () => {
      mockOctokit.issues.listForRepo.mockResolvedValue({
        data: [
          {
            number: 1,
            title: 'Bug',
            user: { login: 'dev' },
            created_at: '2025-01-01T00:00:00Z',
            labels: ['bug', 'critical'],
            html_url: 'https://github.com/user/repo/issues/1',
            state: 'open',
          },
        ],
      })

      const issues = await listIssues('user', 'repo')
      expect(issues[0].labels).toEqual(['bug', 'critical'])
    })
  })

  describe('createIssue', () => {
    it('creates an issue and returns mapped result', async () => {
      mockOctokit.issues.create.mockResolvedValue({
        data: {
          number: 10,
          title: 'New issue',
          user: { login: 'author' },
          created_at: '2025-01-01T00:00:00Z',
          labels: [{ name: 'enhancement' }],
          html_url: 'https://github.com/user/repo/issues/10',
          state: 'open',
        },
      })

      const issue = await createIssue('user', 'repo', 'New issue', 'body text', ['enhancement'])

      expect(mockOctokit.issues.create).toHaveBeenCalledWith({
        owner: 'user',
        repo: 'repo',
        title: 'New issue',
        body: 'body text',
        labels: ['enhancement'],
      })
      expect(issue.number).toBe(10)
      expect(issue.title).toBe('New issue')
    })
  })

  describe('listWorkflowRuns', () => {
    it('maps workflow run data', async () => {
      mockOctokit.actions.listWorkflowRunsForRepo.mockResolvedValue({
        data: {
          workflow_runs: [
            {
              id: 100,
              name: 'CI',
              status: 'completed',
              conclusion: 'success',
              created_at: '2025-01-01T00:00:00Z',
              html_url: 'https://github.com/user/repo/actions/runs/100',
              head_branch: 'main',
            },
          ],
        },
      })

      const runs = await listWorkflowRuns('user', 'repo')

      expect(runs).toHaveLength(1)
      expect(runs[0]).toEqual({
        id: 100,
        name: 'CI',
        status: 'completed',
        conclusion: 'success',
        createdAt: '2025-01-01T00:00:00Z',
        url: 'https://github.com/user/repo/actions/runs/100',
        branch: 'main',
      })
    })
  })

  describe('listNotifications', () => {
    it('maps notification data', async () => {
      mockOctokit.activity.listNotificationsForAuthenticatedUser.mockResolvedValue({
        data: [
          {
            id: '1',
            reason: 'mention',
            subject: { title: 'Bug report', type: 'Issue', url: 'https://api.github.com/issues/1' },
            repository: { full_name: 'user/repo' },
            updated_at: '2025-01-01T00:00:00Z',
          },
        ],
      })

      const notifications = await listNotifications()

      expect(notifications).toHaveLength(1)
      expect(notifications[0]).toEqual({
        id: '1',
        reason: 'mention',
        title: 'Bug report',
        type: 'Issue',
        repo: 'user/repo',
        url: 'https://api.github.com/issues/1',
        updatedAt: '2025-01-01T00:00:00Z',
      })
    })
  })

  describe('getRepoDetail', () => {
    const fullRepoData = {
      name: 'chef-api',
      full_name: 'user/chef-api',
      description: 'API for orchestration',
      stargazers_count: 10,
      forks_count: 3,
      watchers_count: 8,
      open_issues_count: 5,
      size: 2048,
      default_branch: 'main',
      language: 'TypeScript',
      topics: ['api', 'fastify'],
      license: { spdx_id: 'MIT' },
      visibility: 'public',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      pushed_at: '2025-01-15T00:00:00Z',
      html_url: 'https://github.com/user/chef-api',
      private: false,
    }

    it('maps all repo fields correctly', async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: fullRepoData })

      const detail = await getRepoDetail('user', 'chef-api')

      expect(detail.name).toBe('chef-api')
      expect(detail.fullName).toBe('user/chef-api')
      expect(detail.stars).toBe(10)
      expect(detail.forks).toBe(3)
      expect(detail.watchers).toBe(8)
      expect(detail.language).toBe('TypeScript')
      expect(detail.topics).toEqual(['api', 'fastify'])
      expect(detail.license).toBe('MIT')
      expect(detail.defaultBranch).toBe('main')
      expect(detail.size).toBe(2048)
      expect(detail.visibility).toBe('public')
      expect(detail.createdAt).toBe('2024-01-01T00:00:00Z')
    })

    it('handles null license', async () => {
      mockOctokit.repos.get.mockResolvedValue({
        data: { ...fullRepoData, license: null },
      })

      const detail = await getRepoDetail('user', 'chef-api')
      expect(detail.license).toBeNull()
    })

    it('handles missing topics (returns empty array)', async () => {
      mockOctokit.repos.get.mockResolvedValue({
        data: { ...fullRepoData, topics: undefined },
      })

      const detail = await getRepoDetail('user', 'chef-api')
      expect(detail.topics).toEqual([])
    })

    it('falls back to private flag when visibility is missing', async () => {
      mockOctokit.repos.get.mockResolvedValue({
        data: { ...fullRepoData, visibility: undefined, private: true },
      })

      const detail = await getRepoDetail('user', 'chef-api')
      expect(detail.visibility).toBe('private')
    })
  })

  describe('listBranches', () => {
    it('maps branch data correctly', async () => {
      mockOctokit.repos.listBranches.mockResolvedValue({
        data: [
          { name: 'main', protected: true, commit: { sha: 'abc123' } },
          { name: 'develop', protected: false, commit: { sha: 'def456' } },
        ],
      })

      const branches = await listBranches('user', 'repo')

      expect(branches).toHaveLength(2)
      expect(branches[0]).toEqual({ name: 'main', protected: true, sha: 'abc123' })
      expect(branches[1]).toEqual({ name: 'develop', protected: false, sha: 'def456' })
    })

    it('handles repo with no branches', async () => {
      mockOctokit.repos.listBranches.mockResolvedValue({ data: [] })

      const branches = await listBranches('user', 'repo')
      expect(branches).toEqual([])
    })
  })

  describe('listCommits', () => {
    it('maps commit data and truncates message to first line', async () => {
      mockOctokit.repos.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123def456',
            commit: {
              message: 'feat: add new endpoint\n\nDetailed description here',
              author: { name: 'Dev User', date: '2025-01-01T00:00:00Z' },
            },
            author: { login: 'devuser' },
            html_url: 'https://github.com/user/repo/commit/abc123',
          },
        ],
      })

      const commits = await listCommits('user', 'repo')

      expect(commits).toHaveLength(1)
      expect(commits[0].sha).toBe('abc123def456')
      expect(commits[0].message).toBe('feat: add new endpoint')
      expect(commits[0].author).toBe('devuser')
      expect(commits[0].date).toBe('2025-01-01T00:00:00Z')
    })

    it('falls back to commit.author.name when author login is null (deleted account)', async () => {
      mockOctokit.repos.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'xyz789',
            commit: {
              message: 'old commit',
              author: { name: 'Ghost User', date: '2024-01-01T00:00:00Z' },
            },
            author: null,
            html_url: 'https://github.com/user/repo/commit/xyz789',
          },
        ],
      })

      const commits = await listCommits('user', 'repo')
      expect(commits[0].author).toBe('Ghost User')
    })

    it('passes sha parameter when provided', async () => {
      mockOctokit.repos.listCommits.mockResolvedValue({ data: [] })

      await listCommits('user', 'repo', 'develop', 5)

      expect(mockOctokit.repos.listCommits).toHaveBeenCalledWith({
        owner: 'user',
        repo: 'repo',
        sha: 'develop',
        per_page: 5,
      })
    })

    it('omits sha from request when not provided', async () => {
      mockOctokit.repos.listCommits.mockResolvedValue({ data: [] })

      await listCommits('user', 'repo')

      expect(mockOctokit.repos.listCommits).toHaveBeenCalledWith({
        owner: 'user',
        repo: 'repo',
        per_page: 20,
      })
    })
  })

  describe('listReleases', () => {
    it('maps release data correctly', async () => {
      mockOctokit.repos.listReleases.mockResolvedValue({
        data: [
          {
            id: 1,
            tag_name: 'v1.0.0',
            name: 'First Release',
            draft: false,
            prerelease: false,
            created_at: '2025-01-01T00:00:00Z',
            published_at: '2025-01-01T12:00:00Z',
            author: { login: 'releaser' },
            html_url: 'https://github.com/user/repo/releases/tag/v1.0.0',
          },
        ],
      })

      const releases = await listReleases('user', 'repo')

      expect(releases).toHaveLength(1)
      expect(releases[0]).toEqual({
        id: 1,
        tagName: 'v1.0.0',
        name: 'First Release',
        draft: false,
        prerelease: false,
        createdAt: '2025-01-01T00:00:00Z',
        publishedAt: '2025-01-01T12:00:00Z',
        author: 'releaser',
        url: 'https://github.com/user/repo/releases/tag/v1.0.0',
      })
    })

    it('handles null name', async () => {
      mockOctokit.repos.listReleases.mockResolvedValue({
        data: [
          {
            id: 2,
            tag_name: 'v0.1.0',
            name: null,
            draft: true,
            prerelease: true,
            created_at: '2025-01-01T00:00:00Z',
            published_at: null,
            author: { login: 'dev' },
            html_url: 'https://github.com/user/repo/releases/tag/v0.1.0',
          },
        ],
      })

      const releases = await listReleases('user', 'repo')
      expect(releases[0].name).toBeNull()
      expect(releases[0].publishedAt).toBeNull()
      expect(releases[0].draft).toBe(true)
      expect(releases[0].prerelease).toBe(true)
    })

    it('handles repo with no releases', async () => {
      mockOctokit.repos.listReleases.mockResolvedValue({ data: [] })

      const releases = await listReleases('user', 'repo')
      expect(releases).toEqual([])
    })
  })
})
