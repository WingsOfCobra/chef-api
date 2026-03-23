import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import * as github from '../services/github.service'
import { errorRing } from '../lib/error-ring'

const repoSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    fullName: { type: 'string' },
    description: { type: ['string', 'null'] },
    stars: { type: 'number' },
    lastPush: { type: 'string' },
    openIssues: { type: 'number' },
    url: { type: 'string' },
    private: { type: 'boolean' },
  },
} as const

const prSchema = {
  type: 'object',
  properties: {
    number: { type: 'number' },
    title: { type: 'string' },
    author: { type: 'string' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    url: { type: 'string' },
    draft: { type: 'boolean' },
    ciStatus: { type: ['string', 'null'] },
  },
} as const

const issueSchema = {
  type: 'object',
  properties: {
    number: { type: 'number' },
    title: { type: 'string' },
    author: { type: 'string' },
    createdAt: { type: 'string' },
    labels: { type: 'array', items: { type: 'string' } },
    url: { type: 'string' },
    state: { type: 'string' },
  },
} as const

const workflowRunSchema = {
  type: 'object',
  properties: {
    id: { type: 'number' },
    name: { type: 'string' },
    status: { type: ['string', 'null'] },
    conclusion: { type: ['string', 'null'] },
    createdAt: { type: 'string' },
    url: { type: 'string' },
    branch: { type: 'string' },
  },
} as const

const notificationSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    reason: { type: 'string' },
    title: { type: 'string' },
    type: { type: 'string' },
    repo: { type: 'string' },
    url: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const

const ownerRepoParams = {
  type: 'object',
  properties: {
    owner: { type: 'string' },
    repo: { type: 'string' },
  },
  required: ['owner', 'repo'],
} as const

const githubRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /github/repos
  fastify.get('/repos', {
    schema: {
      tags: ['GitHub'],
      summary: 'List GitHub repositories',
      description: 'Returns repositories for the authenticated user, or for a specific org if the "org" query parameter is provided.',
      querystring: {
        type: 'object',
        properties: { org: { type: 'string' } },
      },
      response: {
        200: { type: 'array', items: repoSchema },
      },
    },
  }, async (request, reply) => {
    const query = request.query as { org?: string }
    const cacheKey = `github:repos:${query.org ?? 'me'}`

    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    try {
      const repos = await github.listRepos(query.org)
      fastify.cache.set(cacheKey, repos, 60)
      return repos
    } catch (err: any) {
      const message = err.message?.substring(0, 500) || 'Unknown error'
      fastify.log.error({ service: 'github', err: message, org: query.org }, 'GitHub API call failed')
      errorRing.add({
        timestamp: new Date().toISOString(),
        service: 'github',
        message: `listRepos failed: ${message}`,
      })
      throw err
    }
  })

  // GET /github/repos/:owner/:repo — detailed repo info with languages, commits, contributors, releases
  fastify.get<{ Params: { owner: string; repo: string } }>(
    '/repos/:owner/:repo',
    {
      schema: {
        tags: ['GitHub'],
        summary: 'Get detailed repository information',
        description: 'Returns comprehensive repo info including language breakdown, recent commits, top contributors, open issues/PRs count, and latest release.',
        params: ownerRepoParams,
      },
    },
    async (request) => {
      const { owner, repo } = request.params
      const cacheKey = `github:repo-detailed:${owner}/${repo}`

      const cached = fastify.cache.get(cacheKey)
      if (cached) return cached

      try {
        const detail = await github.getDetailedRepoInfo(owner, repo)
        fastify.cache.set(cacheKey, detail, 60)
        return detail
      } catch (err: any) {
        const message = err.message?.substring(0, 500) || 'Unknown error'
        fastify.log.error({ service: 'github', err: message, repo: `${owner}/${repo}` }, 'GitHub API call failed')
        errorRing.add({
          timestamp: new Date().toISOString(),
          service: 'github',
          message: `getDetailedRepoInfo(${owner}/${repo}) failed: ${message}`,
        })
        throw err
      }
    }
  )

  // GET /github/repos/:owner/:repo/branches
  fastify.get<{ Params: { owner: string; repo: string } }>(
    '/repos/:owner/:repo/branches',
    { schema: { tags: ['GitHub'] } },
    async (request) => {
      const { owner, repo } = request.params
      const cacheKey = `github:branches:${owner}/${repo}`

      const cached = fastify.cache.get(cacheKey)
      if (cached) return cached

      const branches = await github.listBranches(owner, repo)
      fastify.cache.set(cacheKey, branches, 60)
      return branches
    }
  )

  // GET /github/repos/:owner/:repo/commits
  fastify.get<{ Params: { owner: string; repo: string } }>(
    '/repos/:owner/:repo/commits',
    { schema: { tags: ['GitHub'] } },
    async (request) => {
      const { owner, repo } = request.params
      const query = request.query as { sha?: string; per_page?: string }
      const sha = query.sha
      const perPage = query.per_page ? parseInt(query.per_page, 10) : 20
      const cacheKey = `github:commits:${owner}/${repo}:${sha ?? 'default'}`

      const cached = fastify.cache.get(cacheKey)
      if (cached) return cached

      const commits = await github.listCommits(owner, repo, sha, perPage)
      fastify.cache.set(cacheKey, commits, 60)
      return commits
    }
  )

  // GET /github/repos/:owner/:repo/releases
  fastify.get<{ Params: { owner: string; repo: string } }>(
    '/repos/:owner/:repo/releases',
    { schema: { tags: ['GitHub'] } },
    async (request) => {
      const { owner, repo } = request.params
      const cacheKey = `github:releases:${owner}/${repo}`

      const cached = fastify.cache.get(cacheKey)
      if (cached) return cached

      const releases = await github.listReleases(owner, repo)
      fastify.cache.set(cacheKey, releases, 60)
      return releases
    }
  )

  // GET /github/repos/:owner/:repo/prs
  fastify.get<{ Params: { owner: string; repo: string } }>(
    '/repos/:owner/:repo/prs',
    {
      schema: {
        tags: ['GitHub'],
        summary: 'List open pull requests',
        description: 'Returns open pull requests for the specified repository, including CI status.',
        params: ownerRepoParams,
        response: {
          200: { type: 'array', items: prSchema },
        },
      },
    },
    async (request) => {
      const { owner, repo } = request.params
      const cacheKey = `github:prs:${owner}/${repo}`

      const cached = fastify.cache.get(cacheKey)
      if (cached) return cached

      const prs = await github.listPRs(owner, repo)
      fastify.cache.set(cacheKey, prs, 60)
      return prs
    }
  )

  // GET /github/repos/:owner/:repo/pulls/:pull_number — detailed PR view
  fastify.get<{ Params: { owner: string; repo: string; pull_number: string } }>(
    '/repos/:owner/:repo/pulls/:pull_number',
    {
      schema: {
        tags: ['GitHub'],
        summary: 'Get detailed pull request information',
        description: 'Returns comprehensive PR info including files changed, review status, CI check statuses, and diff stats.',
        params: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            pull_number: { type: 'string' },
          },
          required: ['owner', 'repo', 'pull_number'],
        },
      },
    },
    async (request) => {
      const { owner, repo, pull_number } = request.params
      const pullNumber = parseInt(pull_number, 10)
      const cacheKey = `github:pr-detail:${owner}/${repo}/${pullNumber}`

      const cached = fastify.cache.get(cacheKey)
      if (cached) return cached

      const prDetail = await github.getDetailedPRInfo(owner, repo, pullNumber)
      fastify.cache.set(cacheKey, prDetail, 60)
      return prDetail
    }
  )

  // GET /github/repos/:owner/:repo/issues
  fastify.get<{ Params: { owner: string; repo: string } }>(
    '/repos/:owner/:repo/issues',
    {
      schema: {
        tags: ['GitHub'],
        summary: 'List open issues',
        description: 'Returns open issues (excluding pull requests) for the specified repository.',
        params: ownerRepoParams,
        response: {
          200: { type: 'array', items: issueSchema },
        },
      },
    },
    async (request) => {
      const { owner, repo } = request.params
      const cacheKey = `github:issues:${owner}/${repo}`

      const cached = fastify.cache.get(cacheKey)
      if (cached) return cached

      const issues = await github.listIssues(owner, repo)
      fastify.cache.set(cacheKey, issues, 60)
      return issues
    }
  )

  // POST /github/repos/:owner/:repo/issues
  const createIssueSchema = z.object({
    title: z.string().min(1),
    body: z.string().optional(),
    labels: z.array(z.string()).optional(),
  })

  fastify.post<{ Params: { owner: string; repo: string } }>(
    '/repos/:owner/:repo/issues',
    {
      schema: {
        tags: ['GitHub'],
        summary: 'Create a new issue',
        description: 'Creates a new issue in the specified repository with an optional body and labels.',
        params: ownerRepoParams,
        response: {
          201: issueSchema,
        },
      },
    },
    async (request, reply) => {
      const { owner, repo } = request.params
      const body = createIssueSchema.parse(request.body)

      const issue = await github.createIssue(owner, repo, body.title, body.body, body.labels)

      // Invalidate issues cache
      fastify.cache.del(`github:issues:${owner}/${repo}`)

      reply.code(201)
      return issue
    }
  )

  // GET /github/repos/:owner/:repo/workflows — improved with duration and commit info
  fastify.get<{ Params: { owner: string; repo: string } }>(
    '/repos/:owner/:repo/workflows',
    {
      schema: {
        tags: ['GitHub'],
        summary: 'List recent workflow runs',
        description: 'Returns recent GitHub Actions workflow runs with enhanced info: conclusion, duration, and triggering commit details.',
        params: ownerRepoParams,
      },
    },
    async (request) => {
      const { owner, repo } = request.params
      const cacheKey = `github:workflows-enhanced:${owner}/${repo}`

      const cached = fastify.cache.get(cacheKey)
      if (cached) return cached

      const runs = await github.listEnhancedWorkflowRuns(owner, repo)
      fastify.cache.set(cacheKey, runs, 60)
      return runs
    }
  )

  // GET /github/repos/:owner/:repo/runs/:run_id/logs — workflow run logs summary
  fastify.get<{ Params: { owner: string; repo: string; run_id: string } }>(
    '/repos/:owner/:repo/runs/:run_id/logs',
    {
      schema: {
        tags: ['GitHub'],
        summary: 'Get workflow run logs summary',
        description: 'Returns a summary of workflow run logs including job statuses, steps, and conclusions.',
        params: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            run_id: { type: 'string' },
          },
          required: ['owner', 'repo', 'run_id'],
        },
      },
    },
    async (request) => {
      const { owner, repo, run_id } = request.params
      const runId = parseInt(run_id, 10)
      const cacheKey = `github:run-logs:${owner}/${repo}/${runId}`

      const cached = fastify.cache.get(cacheKey)
      if (cached) return cached

      const logs = await github.getWorkflowRunLogs(owner, repo, runId)
      fastify.cache.set(cacheKey, logs, 120) // Cache longer since logs don't change
      return logs
    }
  )

  // GET /github/prs — aggregated across top repos
  fastify.get('/prs', {
    schema: {
      tags: ['GitHub'],
      summary: 'List all open PRs across top repos',
      response: { 200: { type: 'array', items: prSchema } },
    },
  }, async () => {
    const cacheKey = 'github:all-prs'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached
    const prs = await github.listAllPRs()
    fastify.cache.set(cacheKey, prs, 120)
    return prs
  })

  // GET /github/issues — aggregated across top repos
  fastify.get('/issues', {
    schema: {
      tags: ['GitHub'],
      summary: 'List all open issues across top repos',
      response: { 200: { type: 'array', items: issueSchema } },
    },
  }, async () => {
    const cacheKey = 'github:all-issues'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached
    const issues = await github.listAllIssues()
    fastify.cache.set(cacheKey, issues, 120)
    return issues
  })

  // GET /github/workflows — aggregated across top repos
  fastify.get('/workflows', {
    schema: {
      tags: ['GitHub'],
      summary: 'List recent workflows across top repos',
      response: { 200: { type: 'array', items: workflowRunSchema } },
    },
  }, async () => {
    const cacheKey = 'github:all-workflows'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached
    const wf = await github.listAllWorkflows()
    fastify.cache.set(cacheKey, wf, 120)
    return wf
  })

  // GET /github/notifications
  // Cached for 30s with timeout protection against slow GitHub API
  fastify.get('/notifications', {
    schema: {
      tags: ['GitHub'],
      summary: 'List unread notifications',
      description: 'Returns unread GitHub notifications for the authenticated user. Uses a 500ms timeout with stale-cache fallback.',
      response: {
        200: { type: 'array', items: notificationSchema },
      },
    },
  }, async (request) => {
    const cacheKey = 'github:notifications'

    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    try {
      // Race between the API call and a 500ms timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('GitHub API timeout')), 500)
      )

      const notifications = await Promise.race([
        github.listNotifications(),
        timeoutPromise
      ]) as Awaited<ReturnType<typeof github.listNotifications>>

      fastify.cache.set(cacheKey, notifications, 30) // Reduced to 30s
      return notifications
    } catch (err) {
      // Return stale cache if available, otherwise throw
      const staleCache = fastify.cache.get(cacheKey)
      if (staleCache) {
        fastify.log.warn('GitHub API slow/timeout, returning stale cache')
        return staleCache
      }
      throw err
    }
  })
}

export default githubRoutes
