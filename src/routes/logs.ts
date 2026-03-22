import { FastifyPluginAsync } from 'fastify'
import * as logsService from '../services/logs.service'

const logSourceSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    type: { type: 'string' },
    path: { type: ['string', 'null'] },
    last_indexed_at: { type: ['string', 'null'] },
    last_offset: { type: 'number' },
  },
} as const

const logSearchResultSchema = {
  type: 'object',
  properties: {
    source: { type: 'string' },
    line: { type: 'string' },
    timestamp: { type: 'string' },
    rank: { type: 'number' },
  },
} as const

const errorResponse = {
  type: 'object',
  properties: {
    error: { type: 'string' },
  },
} as const

const logsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /logs/files — list configured log sources
  fastify.get('/files', {
    schema: {
      tags: ['Logs'],
      summary: 'List configured log sources',
      description: 'Returns all configured log sources (file, journald, docker) with their indexing status.',
      response: {
        200: { type: 'array', items: logSourceSchema },
      },
    },
  }, async () => {
    const cacheKey = 'logs:files'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const sources = logsService.listLogSources()
    fastify.cache.set(cacheKey, sources, 30)
    return sources
  })

  // GET /logs/tail/:source — tail N lines from a source
  fastify.get<{ Params: { source: string } }>('/tail/:source', {
    schema: {
      tags: ['Logs'],
      summary: 'Tail log lines from a source',
      description: 'Returns the last N lines from the specified log source. Accepts optional "lines" query parameter.',
      params: {
        type: 'object',
        properties: { source: { type: 'string' } },
        required: ['source'],
      },
      querystring: {
        type: 'object',
        properties: { lines: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            source: { type: 'string' },
            lines: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  }, async (request) => {
    const { source } = request.params
    const query = request.query as { lines?: string }
    const lines = query.lines ? parseInt(query.lines, 10) : undefined

    return {
      source,
      lines: logsService.tailSource(source, lines),
    }
  })

  // GET /logs/search — full-text search across indexed logs
  fastify.get('/search', {
    schema: {
      tags: ['Logs'],
      summary: 'Search indexed logs',
      description: 'Full-text search across indexed log entries. Requires the "q" query parameter. Supports optional source, limit, and offset parameters.',
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          source: { type: 'string' },
          limit: { type: 'string' },
          offset: { type: 'string' },
        },
        required: ['q'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            results: { type: 'array', items: logSearchResultSchema },
          },
        },
        400: errorResponse,
      },
    },
  }, async (request, reply) => {
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
  fastify.get('/stats', {
    schema: {
      tags: ['Logs'],
      summary: 'Get log index statistics',
      description: 'Returns the number of indexed lines per log source.',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string' },
              indexed_lines: { type: 'number' },
            },
          },
        },
      },
    },
  }, async () => {
    return logsService.getIndexStats()
  })
}

export default logsRoutes
