import { FastifyPluginAsync } from 'fastify'
import { config } from '../config'
import * as emailService from '../services/email.service'

const emailRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /email/unread — unread count + summaries
  fastify.get('/unread', { schema: { tags: ['Email'] } }, async (request, reply) => {
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
  fastify.get('/search', { schema: { tags: ['Email'] } }, async (request, reply) => {
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
  fastify.get<{ Params: { uid: string } }>('/thread/:uid', { schema: { tags: ['Email'] } }, async (request, reply) => {
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
