import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import * as github from '../services/github.service'

const githubRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /github/repos
  fastify.get('/repos', { schema: { tags: ['GitHub'] } }, async (request, reply) => {
    const query = request.query as { org?: string }
    const cacheKey = `github:repos:${query.org ?? 'me'}`

    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const repos = await github.listRepos(query.org)
    fastify.cache.set(cacheKey, repos, 60)
    return repos
  })

  // GET /github/repos/:owner/:repo/prs
  fastify.get<{ Params: { owner: string; repo: string } }>(
    '/repos/:owner/:repo/prs',
    { schema: { tags: ['GitHub'] } },
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
    { schema: { tags: ['GitHub'] } },
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
    { schema: { tags: ['GitHub'] } },
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
    { schema: { tags: ['GitHub'] } },
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
  fastify.get('/notifications', { schema: { tags: ['GitHub'] } }, async (request) => {
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
