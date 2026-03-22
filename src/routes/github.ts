import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import * as github from '../services/github.service'

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

    const repos = await github.listRepos(query.org)
    fastify.cache.set(cacheKey, repos, 60)
    return repos
  })

  // GET /github/repos/:owner/:repo — detailed repo info
  fastify.get<{ Params: { owner: string; repo: string } }>(
    '/repos/:owner/:repo',
    { schema: { tags: ['GitHub'] } },
    async (request) => {
      const { owner, repo } = request.params
      const cacheKey = `github:repo:${owner}/${repo}`

      const cached = fastify.cache.get(cacheKey)
      if (cached) return cached

      const detail = await github.getRepoDetail(owner, repo)
      fastify.cache.set(cacheKey, detail, 60)
      return detail
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

  // GET /github/repos/:owner/:repo/workflows
  fastify.get<{ Params: { owner: string; repo: string } }>(
    '/repos/:owner/:repo/workflows',
    {
      schema: {
        tags: ['GitHub'],
        summary: 'List recent workflow runs',
        description: 'Returns recent GitHub Actions workflow runs for the specified repository.',
        params: ownerRepoParams,
        response: {
          200: { type: 'array', items: workflowRunSchema },
        },
      },
    },
    async (request) => {
      const { owner, repo } = request.params
      const cacheKey = `github:workflows:${owner}/${repo}`

      const cached = fastify.cache.get(cacheKey)
      if (cached) return cached

      const runs = await github.listWorkflowRuns(owner, repo)
      fastify.cache.set(cacheKey, runs, 60)
      return runs
    }
  )

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
