import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockOctokit = {
  repos: {
    listForAuthenticatedUser: vi.fn(),
    listForOrg: vi.fn(),
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
})
