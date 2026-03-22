import { FastifyPluginAsync } from 'fastify'
import { config } from '../config'
import * as emailService from '../services/email.service'

const emailSummarySchema = {
  type: 'object',
  properties: {
    uid: { type: 'number' },
    subject: { type: 'string' },
    from: { type: 'string' },
    date: { type: 'string' },
    messageId: { type: 'string' },
  },
} as const

const errorResponse = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    hint: { type: 'string' },
  },
} as const

const emailRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /email/unread — unread count + summaries
  fastify.get('/unread', {
    schema: {
      tags: ['Email'],
      summary: 'Get unread email count and previews',
      description: 'Returns the count of unread emails and a summary of up to 50 most recent unread messages. Returns 503 if IMAP is not configured.',
      response: {
        200: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            messages: { type: 'array', items: emailSummarySchema },
          },
        },
        503: errorResponse,
      },
    },
  }, async (request, reply) => {
    if (!config.imapHost) {
      reply.code(503)
      return { error: 'Email monitoring not configured', hint: 'Set IMAP_HOST, IMAP_USER, IMAP_PASS in .env' }
    }

    const cacheKey = 'email:unread'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const result = await emailService.getUnread()
    fastify.cache.set(cacheKey, result, config.emailCacheTtlSeconds)
    return result
  })

  // GET /email/search — search by sender, subject, date range
  fastify.get('/search', {
    schema: {
      tags: ['Email'],
      summary: 'Search emails',
      description: 'Searches emails by sender, subject, and date range. Returns 503 if IMAP is not configured.',
      querystring: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          subject: { type: 'string' },
          since: { type: 'string' },
          before: { type: 'string' },
        },
      },
      response: {
        200: { type: 'array', items: emailSummarySchema },
        503: errorResponse,
      },
    },
  }, async (request, reply) => {
    if (!config.imapHost) {
      reply.code(503)
      return { error: 'Email monitoring not configured' }
    }

    const query = request.query as {
      from?: string
      subject?: string
      since?: string
      before?: string
    }

    const cacheKey = `email:search:${JSON.stringify(query)}`
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const results = await emailService.searchEmails(query)
    fastify.cache.set(cacheKey, results, config.emailCacheTtlSeconds)
    return results
  })

  // GET /email/thread/:uid — fetch message by UID
  fastify.get<{ Params: { uid: string } }>('/thread/:uid', {
    schema: {
      tags: ['Email'],
      summary: 'Get email thread by UID',
      description: 'Fetches a single email message by its IMAP UID. Returns 503 if IMAP is not configured.',
      params: {
        type: 'object',
        properties: { uid: { type: 'string' } },
        required: ['uid'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            messageId: { type: 'string' },
            messages: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  uid: { type: 'number' },
                  subject: { type: 'string' },
                  from: { type: 'string' },
                  date: { type: 'string' },
                  text: { type: 'string' },
                },
              },
            },
          },
        },
        503: errorResponse,
      },
    },
  }, async (request, reply) => {
    if (!config.imapHost) {
      reply.code(503)
      return { error: 'Email monitoring not configured' }
    }

    const uid = parseInt(request.params.uid, 10)
    const cacheKey = `email:thread:${uid}`
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const thread = await emailService.getThread(uid)
    fastify.cache.set(cacheKey, thread, config.emailCacheTtlSeconds)
    return thread
  })
}

export default emailRoutes
