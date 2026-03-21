import { FastifyPluginAsync } from 'fastify'
import * as logsService from '../services/logs.service'

const logsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /logs/files — list configured log sources
  fastify.get('/files', { schema: { tags: ['Logs'] } }, async () => {
    const cacheKey = 'logs:files'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const sources = logsService.listLogSources()
    fastify.cache.set(cacheKey, sources, 30)
    return sources
  })

  // GET /logs/tail/:source — tail N lines from a source
  fastify.get<{ Params: { source: string } }>('/tail/:source', { schema: { tags: ['Logs'] } }, async (request) => {
    const { source } = request.params
    const query = request.query as { lines?: string }
    const lines = query.lines ? parseInt(query.lines, 10) : undefined

    return {
      source,
      lines: logsService.tailSource(source, lines),
    }
  })

  // GET /logs/search — full-text search across indexed logs
  fastify.get('/search', { schema: { tags: ['Logs'] } }, async (request, reply) => {
    const query = request.query as { q?: string; source?: string; limit?: string; offset?: string }

    if (!query.q) {
      reply.code(400)
      return { error: 'Missing required query parameter: q' }
    }

    return {
      query: query.q,
      results: logsService.searchLogs(query.q, {
        source: query.source,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
        offset: query.offset ? parseInt(query.offset, 10) : undefined,
      }),
    }
  })

  // GET /logs/stats — index statistics
  fastify.get('/stats', { schema: { tags: ['Logs'] } }, async () => {
    return logsService.getIndexStats()
  })
}

export default logsRoutes
