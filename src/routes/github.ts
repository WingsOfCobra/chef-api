import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import * as github from '../services/github.service'

const githubRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /github/repos
  fastify.get('/repos', async (request, reply) => {
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
  fastify.get('/notifications', async (request) => {
    const cacheKey = 'github:notifications'

    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const notifications = await github.listNotifications()
    fastify.cache.set(cacheKey, notifications, 60)
    return notifications
  })
}

export default githubRoutes
