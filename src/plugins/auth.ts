import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import { config } from '../config'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const apiKey = request.headers['x-chef-api-key']
      if (!apiKey || apiKey !== config.apiKey) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Missing or invalid X-Chef-API-Key header',
        })
      }
    }
  )

  // Apply auth to all routes by default via onRequest hook
  fastify.addHook('onRequest', async (request, reply) => {
    // Skip swagger docs routes
    if (
      request.url.startsWith('/docs') ||
      request.url === '/system/health' ||
      request.url === '/hooks/agent-event' ||
      request.url.startsWith('/ws/')
    ) {
      return
    }
    await fastify.authenticate(request, reply)
  })
}

export default fp(authPlugin, { name: 'auth' })
